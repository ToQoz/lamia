module.exports = function(type, candidates, input) {
  if (input === undefined) {
    return candidates[0];
  }

  var idx = candidates.indexOf(input);
  if (idx === -1) {
    throw new Error("unknown " + type + ": " + input);
  }
  return candidates[idx];
};
