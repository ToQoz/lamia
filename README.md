# lamia

## Configuration

lamia.jsonnet

```
{
  "name": "example-app",
  "environments": {
    "default": {
      "awsAccountId": "xxx",
      "awsProfile": "xxx-stuff",
      "awsRegion": "AWS_REGION",
      "lambdaRole": "LAMBDA_ROLE",
      "restApiId": "REST_API_ID",
      "stage": "dev"
    }
  },
  "enqueue": {
    "endpoints": [
      {
        "httpMethod": "POST",
        "path": "/queues",
        "requestTemplates": {},
        "responses": {
          "200": {}
        }
      }
    ]
  },
  "dequeue": {
    "events": [
      {
        "name": "polling-1",
        "type": "schedule",
        "config": {
          "schedule": "cron(*/10 * * * ? *)",
          "state": "ENABLED",
        }
      }
    ]
  }

}
```

## Deploy

```
$ lamia deploy
```
