module.exports = function promisifyFunction(fn) {
  return function() {
    var args = Array.prototype.slice.apply(arguments);
    var cb = function(resolve, reject) {
      return function(err, data) {
        if (err) {
          reject(err);
        } else {
          resolve(data);
        }
      };
    };
    return new Promise(function(resolve, reject) {
      fn.apply(null, args.concat(cb(resolve, reject)));
    });
  };
};
