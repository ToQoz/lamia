module.exports = function(cloudWatchEvents, params, cb) {
  cloudWatchEvents.putRule(
    {
      Name: params.Name,
      ScheduleExpression: params.ScheduleExpression,
      State: params.State,
    },
    function(err, data) {
      if (err) return cb(err, null);

      cloudWatchEvents.putTargets(
        {
          Rule: params.Name,
          Targets: [
            {
              Arn: params.Function,
              Id: params.Function.split(":function:").pop().split(":").shift(),
            }
          ]
        },
        cb
      );
    }
  )
};
