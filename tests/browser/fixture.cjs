const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.png': 'image/png', '.wasm': 'application/wasm' };

async function startFixture(staticRoot = path.resolve(__dirname, '../../src/Server/static')) {
    const server = http.createServer(async (request, response) => {
        const pathname = new URL(request.url, 'http://localhost').pathname;
        if (request.method === 'POST') {
            request.resume();
            response.setHeader('Content-Type', 'application/json');
            if (pathname === '/verify_token') return response.end('{"valid":true}');
            if (pathname === '/upload/preflight' || pathname === '/upload/preflight/verify') return response.end('{"files":[]}');
            if (pathname === '/upload_single' || pathname === '/upload_chunk') return response.end('{"success":true,"complete":true}');
            return response.end('{}');
        }
        if (pathname === '/config') {
            response.setHeader('Content-Type', 'application/json');
            return response.end('{}');
        }
        const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/static\//, '');
        const filename = path.resolve(staticRoot, '.' + path.sep + relative);
        if (!filename.startsWith(staticRoot + path.sep)) { response.writeHead(403); return response.end(); }
        try {
            const bytes = await fs.readFile(filename);
            response.setHeader('Content-Type', types[path.extname(filename)] || 'application/octet-stream');
            response.end(bytes);
        } catch { response.writeHead(404); response.end(); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return {
        url: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); })
    };
}
module.exports = { startFixture };
