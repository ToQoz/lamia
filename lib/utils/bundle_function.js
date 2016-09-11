var cp = require('fs-extra').copySync;
var fs = require('fs');
var path = require('path');

var assign = require("object-assign");
var browserify = require('browserify');
var getDependencies = require('dependency-list');

var src = require("gulp").src;
var dest = require("gulp").dest;
var source = require("vinyl-source-stream");
var merge = require('merge-stream')

// - opts
//   - fuctionName - **required** - `String`
//   - src - **required** - `String`
//   - dst - **required** - `String`
//   - zip - defaults to true - `Boolean`
//   - entry - defaults to 'index.js' - `String`
//   - includes - defaults to `[]` - `Array<String>`
//   - browserify - `map`
//     - exclude - defaults to `["aws-sdk"]` - `Array<String>`
//     - transforms - defaults to `[]` -  `Array<String>`
// - cb - `function(err) {}`
module.exports = function(opts, cb) {
  opts = assign({}, opts);

  opts.entry = opts.entry || 'index.js';
  if (opts.zip != false) {
    opts.zip = true;
  }

  var s = path.join(opts.src, opts.functionName);
  var d = path.join(opts.dst, opts.functionName);

  var onerror = function(err) {
    cb(err);
  };

  var handlerjs = path.join(s, opts.entry);
  var includes = (opts.includes || []).map(function(rel) {
    return path.join(s, rel);
  });
  var streams = [src(includes), bundle(handlerjs, opts.browserify)];

  var q = ((opts.browserify && opts.browserify.exclude) || []).map(function(dep) {
    var exec = require('child_process').exec;

    return new Promise(function(resolve, reject) {
      exec("npm ls " + dep + " --json", function(err, stdout, stderr) {
        if (err) reject(err);
        else {
          var version = JSON.parse(stdout).dependencies[dep].version;
          var opts = {};
          opts[dep] = version;
          getDependencies(opts, function(err, data) {
            if (err) {
              reject(err);
            } else {
              var deps = Object.keys(data).map(function(d) {
                return path.join("node_modules", d, "**", "*");
              });
              streams.push(src(deps.concat(path.join("node_modules", dep, "**", "*")), {base: "./"}));
              resolve();
            }
          })
        }
      });
    });
  });

  var glob = require('glob');
  var yazl = require('yazl');

  Promise.all(q).then(function() {
    merge(streams)
      .pipe(dest(d))
      .on('error', onerror)
      .on('end', function() {
        if (opts.zip) {
          var zip = new yazl.ZipFile();

          glob.sync(path.join(d, '**', '*')).forEach(function(_path) {
            if (!fs.lstatSync(_path).isDirectory()) {
              zip.addFile(_path, path.relative(d, _path));
            }
          });

          out = fs.createWriteStream(path.join(d, 'bundle.zip'))
          zip.outputStream.pipe(out).on('close', cb);
          zip.end();
        } else {
          cb();
        }
      });
  }).catch(function(err) {
    cb(err);
  });
};

function bundle(file, browserifyConfig) {
  var to = source(path.basename(file));

  if (browserifyConfig) {
    var b = browserify({
      entries: [file],
      standalone: 'lambda',
      browserField: false,
      builtins: false,
      commondir: false,
      detectGlobals: false,
      insertGlobalVars: {
        process: function () {
          return;
        },
      }
    });

    (browserifyConfig.transforms || []).forEach(function(tf) { b.transform(require(tf)); });
    var exclude = browserifyConfig.exclude || [];
    exclude.concat(["aws-sdk"]).forEach(function(ex) { b.exclude(ex); });

    return b.bundle().pipe(to);
  } else {
    return fs.createReadStream(file).pipe(to);
  }
}
