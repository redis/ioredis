const http = require('node:http');
const ioredis = require('ioredis');

const client = new ioredis();

async function streamFromRedis(key, response) {
    const dataStream = client.getStream(key, {
        chunkSize: 100 * 10,
        pipeline: false,
    });

    for await (const data of dataStream) {
        response.write(data);
    }

    response.end();

}

async function sendFromRedis(key, response) {
    const reply = await client.get(key);
    response.end(reply);
}

const server = http.createServer();

server.on('request', (request, response) => {
    if (request.url === '/stream') {
        streamFromRedis('test', response).catch(console.error);
    } else {
        sendFromRedis('test', response).catch(console.error);
    }
});

server.listen(3000);

