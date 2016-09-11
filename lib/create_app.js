var path = require('path');

var values = require('object-values');
var assign = require("object-assign");
var sprintf = require('sprintf-js').sprintf;

var parseConfigFile = require('./utils/parse_config_file');
var promisifyFunction = require('./utils/promisify_function');
var bundleFunction = promisifyFunction(require("./utils/bundle_function"));

var FUNCTION_DIRNAME = "functions";

module.exports = function(opts, cb) {
  var createApp = function(config, opts, cb) {
    validateConfig(config, function(err) {
      if (err) {
        cb(err, null);
      } else {
        cb(null, new App(config, opts))
      }
    });
  };

  if ("configFile" in opts) {
    parseConfigFile(opts.configFile, function(err, file, data) {
      console.log("createApp:config:use " + file);

      if (err) {
        cb(err, null);
      } else {
        delete opts.configFile;
        createApp(data, opts, cb);
      }
    });
  } else if ("configData" in opts) {
    var data = opts.configData;
    delete opts.configData;
    createApp(data, opts, cb);
  } else {
    cb(new Error("configFile or configData is required"), null);
  }
};

function App(config, opts) {
  assign(this, config);


  if (!(opts.environment in config.environments)) {
    throw new Error(sprintf("environment `%s` is not found", opts.environment));
  }
  assign(this, config.environments[opts.environment]);
}

App.prototype.storeRestApi = function(restApi) {
  this.restApiId = restApi.id;
};

App.prototype.get = function(k, ignoreEnvVars) {
  if (typeof(this[k]) == 'function') {
    return this[k]();
  } else {
    return this[k];
  }
};

App.prototype.functionArn = function(functionName) {
  return sprintf("arn:aws:lambda:%s:%s:function:%s", this.awsRegion, this.awsAccountId, this.addPrefix(functionName));
};

App.prototype.lambdaRoleArn = function() {
  return sprintf('arn:aws:iam::%s:role/%s', this.awsAccountId, this.lambdaRole);
};

App.prototype.listEvents = function() {
  if (!this._events) {
    this._events = [];
    Object.keys(this.get('functions')).forEach(function(functionName) {
      var fn = this.get('functions')[functionName];
      if (fn.events) {
        fn.events.forEach(function(event) {
          this._events.push(assign({functionName: functionName}, event));
        }.bind(this));
      }
    }.bind(this));
  }

  return this._events;
};

App.prototype.listEndpoints = function() {
  if (!this._endpoints) {
    this._endpoints = [];
    Object.keys(this.get('functions')).forEach(function(functionName) {
      var fn = this.get('functions')[functionName];
      if (fn.endpoints) {
        fn.endpoints.forEach(function(endpoint) {
          this._endpoints.push(assign({functionName: functionName}, endpoint));
        }.bind(this));
      }
    }.bind(this));
  }

  return this._endpoints;
};

App.prototype.getRestApiURL = function() {
  if (!this.restApiId) {
    throw new Error("restApiId must be set");
  }

  return sprintf("deploy:done https://%s.execute-api.%s.amazonaws.com/%s", this.restApiId, this.awsRegion, this.stage);
}

App.prototype.addPrefix = function(value) {
  return this.get("name") + "-" + value;
}

App.prototype.bundleFunctions = function(dst, zip) {
  return Promise.all(Object.keys(this.get('functions')).map(this._bundleFunction.bind(this, dst, zip)));
};

App.prototype._bundleFunction = function(dst, zip, functionName) {
  var src = path.join(".", "functions");
  var dst = path.join(dst, "functions");
  var entry = 'index.js';

  console.log(sprintf('createApp:function:bundle %s ---> %s', path.join(src, functionName, entry), path.join(dst, functionName, entry)));

  var params = {
    functionName: functionName,
    entry: entry,
    src: src,
    dst: dst,
    zip: zip,
    includes: this.get('functions')[functionName].includes,
    browserify: this.get('functions')[functionName].browserify,
  };

  if (this.get('functions')[functionName].browserify !== false) {
    params.browserify = this.get('functions')[functionName].browserify || {};
    params.browserify.transforms = ["brfs"];
  }

  return bundleFunction(params);
}

function validateConfig(config, cb) {
  cb(null);
}
