#!/usr/bin/env node

var DEBUG = process.env.DEBUG;

var fs = require('fs');
var path = require('path');

var dispatch = require('./dispatch');
var argv = require('minimist')(process.argv.slice(2), {
  boolean: ['help', 'dry-run'],
  string: ['on-no-api-found', 'no-single-api-found', 'on-multiple-api-found'],
  alias: {
    'c': 'config-file',
    'e': 'environment',
    'p': 'port',
    't': 'timeout',
    'd': 'dry-run',
    'h': 'help',
    'on-no-af': 'on-no-api-found',
    'on-1-af': 'on-single-api-found',
    'on-m-af': 'on-multiple-apis-found',
  },
  default: {
    port: 8008,
    environment: 'default',
    timeout: '3s'
  }
});

if (argv.h || argv.help) {
  return usage();
}

var lamia = require('../index.js');

var opts = {
  configFile: argv['config-file'],
  environment: argv.environment,
  onNoApiFound: dispatch('action', ["create", "update", "error"], argv['on-no-api-found']), // default: create
  onSingleApiFound: dispatch('action', ["update", "create", "error"], argv['on-single-api-found']), // default: update
  onMultipleApisFound: dispatch('action', ["update", "create", "prompt", "error"], argv['on-multiple-apis-found']), // default: update
};
lamia.createApp(opts, function(err, app) {
  if (err) {
    return error(err);
  }

  switch (argv._[0]) {
    case "serve":
    case "s":
      opts = {
        port: argv.port,
        timeout: argv.timeout,
      };
      lamia.serve(app, opts, function(err) {
        if (err) {
          error(err);
        }
      });
      break;
    case "deploy":
    case "d":
      otps = {
        dryRun: argv['dry-run'],
      };
      lamia.deploy(app, opts, function(err) {
        if (err) {
          error(err);
        }
      });
      break;
    default:
      usage();
  }
});

function usage() {
  fs
    .createReadStream(path.join(__dirname, 'usage.txt'))
    .pipe(process.stderr);
}

function error(err) {
  if (DEBUG) {
    if ('stack' in err) {
      console.error(err.stack);
    } else {
      console.error(err.toString());
      console.dir(err);
    }
  } else {
    console.error(err.toString());
  }
}
