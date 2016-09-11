var fs = require('fs');
var path = require('path');

var assign = require("object-assign");
var sprintf = require('sprintf-js').sprintf;
var strftime = require('strftime');
var prompt = require('prompt');

var AWS = require('aws-sdk');

var promisifyAll = require('bluebird').promisifyAll;
var promisifyFunction = require('./utils/promisify_function');

var bundleFunction = promisifyFunction(require("./utils/bundle_function"));

var putFunction = retryable(promisifyFunction(require('lambda-put-function')));
var putPermission = retryable(promisifyFunction(require('lambda-put-permission')));
var putAlias = retryable(promisifyFunction(require('lambda-put-alias')));
var putScheduledEvent = retryable(promisifyFunction(require('./utils/put_function_schedule.js')));

var putResource = retryable(promisifyFunction(require('api-gateway-put-resource')));
var putMethod = retryable(promisifyFunction(require('api-gateway-put-method')));
var putMethodResponse = retryable(promisifyFunction(require('api-gateway-put-method-response')));

var DIST = "./dist";

module.exports = function(app, opts, cb) {
  if (arguments.length === 2 && typeof opts === 'function') {
    cb = opts;
    opts = {};
  }

  return new Deployer(app, opts).deploy(cb);
};

function Deployer(app, opts) {
  this.app = app;
  this.opts = opts;
};

Deployer.prototype.deploy = function(cb) {
  this.setAwsProfile(this.app.awsProfile);
  this.lambdaClient = new AWS.Lambda({
    region: this.app.awsRegion
  });
  this.apiGatewayClient = new AWS.APIGateway({
    region: this.app.awsRegion
  });
  this.cloudWatchEventsClient = new AWS.CloudWatchEvents({
    region: this.app.awsRegion
  });

  promisifyAll(Object.getPrototypeOf(this.apiGatewayClient));

  return Promise.resolve()
    .then(this.app.bundleFunctions.bind(this.app, DIST))
    .then(this.selectRestApi.bind(this))
    .then(this.putLambdaFunctions.bind(this))
    .then(this.putEvents.bind(this))
    .then(this.putRestApiResources.bind(this))
    .then(function(data) {
      return Promise
        .resolve()
        .then(this.putRestApiMethods.bind(this, data.items))
        .then(this.putRestApiIntegrations.bind(this, data.items));
    }.bind(this))
    .then(this.deployRestApi.bind(this))
    .then(this.app.getRestApiURL.bind(this.app))
    .then(function(url) {
      console.log(url);
      cb(null);
    })
    .catch(function(err) {
      console.log(err.stack);
      cb(err);
    });
};

Deployer.prototype.setAwsProfile = function(profile) {
  var credentials = new AWS.SharedIniFileCredentials({
    profile: profile
  });
  AWS.config.credentials = credentials;
};

Deployer.prototype.putLambdaFunctions = function() {
  console.log('deploy:api-gateway:deploy-functions');

  var _putFunction = function(functionName){
    console.log("put-function " + functionName);
    var zipData = fs.readFileSync(path.join(DIST, 'functions', functionName, 'bundle.zip'));
    dropTimestampInZip(zipData);

    return putFunction(this.lambdaClient, {
      FunctionName: this.app.addPrefix(functionName),
      Runtime: "nodejs",
      Role: this.app.lambdaRoleArn(),
      Handler: 'index.handler',
      Timeout: this.app.functions[functionName].timeout || 15,
      MemorySize: 128,
      Publish: true,
      Code: {
        ZipFile: zipData
      }
    }).then(logAPI);
  }.bind(this);

  var _putAlias = function(fn) {
    console.log("put-alias " + fn.FunctionName);

    return putAlias(this.lambdaClient, {
      FunctionName: fn.FunctionName,
      FunctionVersion: fn.Version,
      Name: this.app.get("stage"),
    });
  }.bind(this)

  return Promise.all(Object.keys(this.app.functions).map(function(functionName, i) {
    return Promise.resolve()
      .then(function() { return functionName; })
      .then(_putFunction)
      .then(_putAlias);
  }));
};

Deployer.prototype.putEvents = function() {
  console.log('deploy:api-gateway:deploy-events');

  var eventName = function(event) {
    return [this.app.addPrefix(event.functionName), event.name, this.app.stage].join("-");
  }.bind(this);

  var put = function(event) {
    var eventConfig = event.config;

    if (event.type === 'schedule') {
      var params = {
        Name: eventName(event),
        ScheduleExpression: eventConfig.schedule,
        State: eventConfig.state,
        Function: this.app.functionArn(event.functionName) + ":" + this.app.stage,
      };
      return putScheduledEvent(this.cloudWatchEventsClient, params)
    } else {
      return Promise.reject("unknown event source type: " + event.type);
    }
  }.bind(this);

  var permit = function(event) {
    var statementId = ['events', eventName(event), 'invoke'].join('-');
    return putPermission(this.lambdaClient, {
      StatementId: statementId,
      Action: 'lambda:InvokeFunction',
      FunctionName: this.app.addPrefix(event.functionName),
      Principal: 'events.amazonaws.com',
      Qualifier: this.app.stage
    });
  }.bind(this);

  return Promise.all(this.app.listEvents().map(function(event, i) {
    return Promise.resolve()
      .then(function() { return put(event); })
      .then(function() { return permit(event); })
    ;
  }));
};

Deployer.prototype.selectRestApi = function() {
  console.log('deploy:api-gateway:find-or-create-rest-api ' + this.app.name);

  var listApi = function() {
    return this.apiGatewayClient
      .getRestApisAsync({
        limit: 500
      })
      .then(function(data) {
        return data.items;
      });
  };
  var filterApiByName = function(apis) {
    var name = this.app.name;
    return apis.filter(function(restApi) { return restApi.name === name; });
  };
  var createOrSelectApi = function(apis) {
    if (apis.length === 0) {
      console.log('deploy:api-gateway:create-rest-api ' + this.app.name);
      return this.apiGatewayClient.createRestApiAsync({
        name: this.app.name
      });
    } else if (apis.length === 1) {
      console.log('deploy:api-gateway:use-rest-api ' + apis[0].id);
      return apis[0];
    } else {
      apis.sort(function(a, b) { return +a.createdDate - +b.createdDate; });

      process.stdout.write(sprintf("Multiple apis are found that are named `%s`\n", this.app.name));
      process.stdout.write("Select a api. (default is 0)\n");
      apis.forEach(function(api, i) {
        process.stdout.write(sprintf("%2d) %s\n", i, describeApi(api)));
      });

      return new Promise(function(resolve, reject) {
        prompt.start();
        prompt.get(['index'], function (err, result) {
          if (err) {
            reject(err);
          } else {
            resolve(apis[result.index]);
          }
        });
      });
    }
  };

  return Promise.resolve()
    .then(listApi.bind(this))
    .then(filterApiByName.bind(this))
    .then(createOrSelectApi.bind(this))
    .then(this.app.storeRestApi.bind(this.app));
};

Deployer.prototype.putRestApiResources = function() {
  console.log('deploy:api-gateway:put-rest-api-resources');

  return putResource(this.apiGatewayClient, {
    restApiId: this.app.restApiId,
    path: this.app.listEndpoints().map(function(e) { return e.path; }),
    deleteOthers: true,
    dryRun: false
  }).then(logAPI);
};

Deployer.prototype.putRestApiMethods = function(resources) {
  console.log('deploy:api-gateway:put-rest-api-methods');

  var _putMethods = function(res) {
    var methods = this.app.listEndpoints()
      .filter(function(endpoint) { return endpoint.path === res.path; })
      .map(function(endpoint) {
        return {
          httpMethod: endpoint.httpMethod,
          authorizationType: endpoint.authorizationType || 'NONE', // defaults to 'NONE'
          apiKeyRequired: endpoint.apiKeyRequired === true ? true : false, // defaults to false
          requestParameters: endpoint.requestParameters || {}, // defaults to {}
          requestModels: endpoint.requestModels || {}, // defaults to {}
        };
      });

    var params = {
      restApiId: this.app.restApiId,
      resourceId: res.id,
      methods: methods,
      deleteOthers: true,
      dryRun: false
    };
    return putMethod(this.apiGatewayClient, params).then(logAPI);
  }.bind(this);

  var _putMethodResponses = function(res) {
    var q = this.app.listEndpoints()
      .filter(function(endpoint) { return endpoint.path === res.path; })
      .map(function(endpoint) {
        var params = {
          restApiId: this.app.restApiId,
          resourceId: res.id,
          httpMethod: endpoint.httpMethod,
          responses: Object.keys(endpoint.responses).map(function(statusCode) {
            var res = endpoint.responses[statusCode];
            return {
              statusCode: statusCode,
              responseModels: res.responseModels || {},
            };
          }),
          deleteOthers: true,
          dryRun: false
        }
        return putMethodResponse(this.apiGatewayClient, params).then(logAPI);
      }.bind(this));

    return Promise.all(q);
  }.bind(this);

  return Promise
    .resolve()
    .then(function() { return Promise.all(resources.map(_putMethods)) })
    .then(function() { return Promise.all(resources.map(_putMethodResponses)) });
};

Deployer.prototype.putRestApiIntegrations = function(resources) {
  console.log('deploy:api-gateway:put-rest-api-integrations');

  var putIntegration = function(endpoint, res) {
    var functionName = endpoint.functionName;
    var res = resources.find(function(res) {
      return res.path === endpoint.path;
    });

    var put = retryable(this.apiGatewayClient.putIntegrationAsync.bind(this.apiGatewayClient));

    return put({
      restApiId: this.app.restApiId,
      resourceId: res.id,
      httpMethod: endpoint.httpMethod,
      integrationHttpMethod: "POST",
      type: "AWS",
      requestTemplates: endpoint.requestTemplates,
      uri: sprintf("arn:aws:apigateway:%s:lambda:path/2015-03-31/functions/%s:%s/invocations", this.app.awsRegion, this.app.functionArn(functionName), this.app.get("stage"))
    });
  };

  var putIntegrationResponse = function(endpoint) {
    var res = resources.find(function(res) {
      return res.path === endpoint.path;
    });

    var put = retryable(this.apiGatewayClient.putIntegrationResponseAsync.bind(this.apiGatewayClient))

    var q = Promise.resolve();
    Object.keys(endpoint.responses).map(function(statusCode) {
      var response = endpoint.responses[statusCode];
      q = q.then(function() {
        return put({
          restApiId: this.app.restApiId,
          resourceId: res.id,
          httpMethod: endpoint.httpMethod,
          statusCode: statusCode,
          selectionPattern: response.selectionPattern,
          responseTemplates: response.responseTemplates || {}
        });
      }.bind(this));
    }.bind(this));
    return q;
  };

  var permitInvoking = function(endpoint) {
    var functionName = endpoint.functionName;
    var statementId = [endpoint.httpMethod, endpoint.path.replace(/\/|{|}/g, '_'), 'invoke', this.app.addPrefix(functionName)].join('-');
    return putPermission(this.lambdaClient, {
      StatementId: statementId,
      Action: 'lambda:InvokeFunction',
      FunctionName: this.app.addPrefix(functionName),
      Principal: 'apigateway.amazonaws.com',
      SourceArn: sprintf('arn:aws:execute-api:%s:%s:%s/*/%s', this.app.awsRegion, this.app.awsAccountId, this.app.restApiId, endpoint.httpMethod + endpoint.path),
      Qualifier: this.app.stage
    });
  };

  var q = Promise.resolve();
  this.app.listEndpoints().forEach(function(endpoint) {
    q = q
      .then(putIntegration.bind(this, endpoint))
      .then(putIntegrationResponse.bind(this, endpoint))
      .then(permitInvoking.bind(this, endpoint));
  }.bind(this));

  return q;
};

Deployer.prototype.deployRestApi = function() {
  console.log('deploy:api-gateway:deploy-api');

  var deploy = retryable(this.apiGatewayClient.createDeploymentAsync.bind(this.apiGatewayClient));

  return deploy({
    restApiId:        this.app.restApiId,
    stageName:        this.app.stage,
    stageDescription: this.app.stage,
    variables: {
      alias: this.app.stage
    }
  });
};

function describeApi(api) {
  var createdAt = strftime("%Y/%m/%d %H:%M:%S", api.createdDate);
  return sprintf("%s (created at %s) %s", api.id, createdAt, api.description || "");
}

function logAPI(data) {
  (data.operations || []).forEach(function(op) {
    delete op.params.ZipFile
    if ('message' in op) {
      console.log(op.message);
    } else {
      var txt = sprintf("%s(%s)", op.op, JSON.stringify(op.params));
      console.log(txt);
    }
  });
  return data;
}

function dropTimestampInZip(zipData) {
  // remove last modification time/date
  // https://en.wikipedia.org/wiki/Zip_(file_format)#File_headers

  // http://d.hatena.ne.jp/runicalp/comment/20100625
  // http://techblog.raccoon.ne.jp/archives/47967009.html

  // FIXME ファイル内にシグネチャと一致するやつがあるかもしれないので、
  // 後ろのセントラルディレクトリから位置をとってくる必要アリ
  for (var i = 0; i < zipData.length; i++) {
    // 504B0304
    // local file header 0x504B0102
    if (zipData[i-3] === 0x50 && zipData[i-2] === 0x4b && zipData[i-1] === 0x03 && zipData[i] === 0x04) {
      offset = i - 3
      zipData[offset+10] = 0;
      zipData[offset+11] = 0;
      zipData[offset+12] = 0;
      zipData[offset+13] = 0;
    }
    // central directory file header 0x504B0102
    if (zipData[i-3] === 0x50 && zipData[i-2] === 0x4b && zipData[i-1] === 0x01 && zipData[i] === 0x02) {
      offset = i - 3
      zipData[offset+12] = 0;
      zipData[offset+13] = 0;
      zipData[offset+14] = 0;
      zipData[offset+15] = 0;
    }
  }
}

function retryable(op) {
  return function() {
    var args = Array.prototype.slice.apply(arguments);

    return new Promise(function(resolve, reject){
      var _retryable = function(count) {
        op.apply(null, args)
          .then(resolve)
          .catch(function(err) {
            count++
            if (+err.statusCode === 429 && count <= 12) { // TooManyReuqestException
              var swing = Math.floor(Math.random() * 5000) + 500;
              setTimeout(function() { _retryable(count); }, count * 5000 + swing);
            } else {
              reject(err);
            }
          });
      };

      _retryable(0);
    });
  }
}
