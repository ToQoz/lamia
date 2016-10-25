var yaml = require('js-yaml');

var path = require('path');
var exec = require('child_process').exec;
var sprintf = require('sprintf-js').sprintf;

var assign = require("object-assign");
var readAny = require("read-any-one-file");

var DEFAULT_CONFIG_FILES = ["lamia.json", "lamia.yml", "lamia.jsonnet", "lamia.js"];
var PARSERS = {
  ".json": parseJson,
  ".yml": parseYaml,
  ".jsonnet": parseJsonnet,
  ".js": parseJavaScript,
};

module.exports = function(configFile, cb) {
  var files = configFile ? [configFile] : DEFAULT_CONFIG_FILES;

  readAny(files, function(err, file, data) {
    if (err) {
      cb(err, null);
    } else {
      var ft = path.extname(file);
      var parse = PARSERS[ft];

      if (!parse) {
        cb(new Error(sprintf("file type `%s` is not supported. supported file types are json, jsonnet and javascript"), ft), null);
      } else {
        parse(file, data, cb);
      }
    }
  });
}

function parseJsonnet(file, data, cb) {
  exec('jsonnet ' + file, function(err, stdout, stderr) {
    if (err) {
      cb(err, file, null);
    } else {
      cb(null, file, JSON.parse(stdout));
    }
  });
}

function parseYaml(file, data, cb) {
  var config = null;
  var err = null;

  try {
    config = yaml.safeLoad(data);
  } catch(e) {
    err = e;
  }

  cb(err, file, config);
}

function parseJson(file, data, cb) {
  var config = null;
  var err = null;

  try {
    data = JSON.parse(config)
  } catch(e) {
    err = e;
  }

  cb(err, file, config);
}

function parseJavaScript(file, _, cb) {
  var data = null;
  var err = null;

  if (!path.isAbsolute(file)) {
    file = path.join(process.cwd(), file);
  }

  try {
    data = require(file);
  } catch(e) {
    err = e;
  }

  cb(err, file, data)
}
