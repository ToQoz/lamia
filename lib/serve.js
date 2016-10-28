var path = require('path');

var sprintf = require('sprintf-js').sprintf;
var express = require('express');
var timeout = require('connect-timeout');
var apiGatewayLocal = require('api-gateway-localdev');

module.exports = function(app, opts, cb) {
  process.env.AWS_REGION = app.awsRegion;

  if (arguments.length === 2 && typeof opts === 'function') {
    cb = opts;
    opts = {};
  }

  var dir = "dist";

  var expire = null;

  app.bundleFunctions(dir, false)
    .then(function() {
      var pwd = process.cwd();

      var webapp = express();
      webapp.use(timeout(opts.timeout || '3s'));

      var functions = app.get('functions');
      var routes = Object.keys(functions).reduce(function(routes, functionName) {
        var handlerFile = path.join(dir, "functions", functionName, "index.js");
        var handler = function(event, context) {
          var h = require(path.join(pwd, handlerFile)).handler;

          if (!expire || Date.now() > expire) {
            event.__express_req.clearTimeout();
            assumeRole(app, function(data, err) {
              if (err) console.log(err);
              else {
                expire = +data.Credentials.Expiration
                h(event, context);
              }
            });
          } else {
            h(event, context);
          }
        };

        (functions[functionName].endpoints || []).forEach(function(endpoint) {
          var path = endpoint.path;

          console.log(sprintf("serve:map %s %s ---> %s", endpoint.httpMethod, path, handlerFile));
          routes.push({
            lambda: handler,
            method: endpoint.httpMethod,
            path: path,
            requestTemplates: endpoint.requestTemplates,
            responses: endpoint.responses
          });
        });

        return routes;
      }, []);

      apiGatewayLocal(webapp, routes);

      webapp.listen(opts.port, '0.0.0.0')
        .on('error', function(err) {
          cb(err);
        })
        .on('listening', function() {
          console.log(sprintf("serve:listen %s:%s", '0.0.0.0', opts.port));
        })
        .on('close', function() {
          cb();
        });
    })
    .catch(function(err) {
      cb(err);
    });
};

var AWS = require('aws-sdk');

function assumeRole(app, cb) {
  AWS.config.credentials = new AWS.SharedIniFileCredentials({
    profile: app.awsProfile
  });

  var sts = new AWS.STS();
  sts.assumeRole(
    {
      RoleArn: app.lambdaRoleArn(),
      RoleSessionName: 'lamia-local-' + app.name,
    } ,
    function(err, data) {
      if (err) cb(null, err);
      else {
        AWS.config.credentials = sts.credentialsFrom(data);
        cb(data, null);
      }
    }
  );
}
