## Express Example

This example demonstrates how to use ioredis in a web application.

The idea is to create a shared Redis instance for the entire application,
intead of using a connection pool or creating a new Redis instance for every
file or even for every request.

### Install

```
npm install
```

### Start

```
npm start
```

Then visit http://localhost:3000/