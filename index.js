const http = require('http');
const url = require('url');
const fs = require('fs').promises;
const path = require('path');

class App {
    constructor() {
        this.routes = {
            GET: new Map(),
            POST: new Map(),
            PUT: new Map(),
            PATCH: new Map(),
            DELETE: new Map()
        };
        this.middleware = [];
    }

    use(fn) {
        this.middleware.push(fn);
    }

    _matchRoute(method, pathname) {
        const routes = this.routes[method];
        if (!routes) return null;
        for (let [pattern, handler] of routes) {
            const match = pathname.match(pattern.regex);
            if (match) {
                return { handler, params: match.groups || {} };
            }
        }
        return null;
    }

    _dispatch(req, res, middlewares, index = 0) {
        if (index >= middlewares.length) return;
        const fn = middlewares[index];
        fn(req, res, () => this._dispatch(req, res, middlewares, index + 1));
    }

    _handleRequest(req, res) {
        req.params = {};
        req.query = {};
        req.body = {};
        res.statusCode = 200;
        res.send = (body) => {
            res.setHeader('Content-Type', 'text/html');
            res.end(body);
        };
        res.json = (data) => {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(data));
        };
        res.status = (code) => {
            res.statusCode = code;
            return res;
        };

        const parsedUrl = url.parse(req.url, true);
        req.url = parsedUrl.pathname;
        req.query = parsedUrl.query;

        if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', () => {
                try {
                    req.body = JSON.parse(body);
                } catch {
                    req.body = {};
                }
                this._processRequest(req, res);
            });
            return;
        }

        this._processRequest(req, res);
    }

    _processRequest(req, res) {
        const routeMatch = this._matchRoute(req.method, req.url);
        const handlers = [...this.middleware, ...(routeMatch ? [routeMatch.handler] : [])];
        this._dispatch(req, res, handlers, 0);
        if (!routeMatch) {
            res.status(404).json({ error: 'Not Found' });
        }
    }

    addRoute(method, pathStr, handler) {
        const regexStr = pathStr.replace(/:[^\/]+/g, '(?<$1>[^/]+)').replace(/\/$/, '') + '(?:\/|$)?';
        this.routes[method].set({ regex: new RegExp(`^${regexStr}`) }, handler);
    }

    get(pathStr, handler) { this.addRoute('GET', pathStr, handler); }
    post(pathStr, handler) { this.addRoute('POST', pathStr, handler); }
    put(pathStr, handler) { this.addRoute('PUT', pathStr, handler); }
    patch(pathStr, handler) { this.addRoute('PATCH', pathStr, handler); }
    delete(pathStr, handler) { this.addRoute('DELETE', pathStr, handler); }

    listen(port, handler) {
        const server = http.createServer((req, res) => {
            try {
                this._handleRequest(req, res);
            } catch (err) {
                console.error(err);
                res.statusCode = 500;
                res.json({ error: 'Internal Server Error' });
            }
        });
        server.listen(port, handler);
        return server;
    }
}

const app = new App();

app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
    next();
});

const readData = async (file) => {
    try {
        return JSON.parse(await fs.readFile(path.join(__dirname, file), 'utf8'));
    } catch {
        return [];
    }
};
const writeData = async (file, data) => {
    await fs.writeFile(path.join(__dirname, file), JSON.stringify(data, null, 2));
};
const findById = (data, id) => data.find(item => item.id === Number(id));
const updateOrCreate = (data, id, updates) => {
    const idx = data.findIndex(item => item.id === Number(id));
    if (idx > -1) {
        data[idx] = { ...data[idx], ...updates };
    } else {
        const newId = Math.max(...data.map(d => d.id || 0), 0) + 1;
        data.push({ id: newId, ...updates });
    }
    return data;
};

app.get('/visitors', async (req, res) => {
    const visitors = await readData('visitors.json');
    res.json(visitors);
});
app.get('/visitors/:id', async (req, res) => {
    const visitors = await readData('visitors.json');
    const visitor = findById(visitors, req.params.id);
    visitor ? res.json(visitor) : res.status(404).json({ error: 'Visitor not found' });
});
app.post('/visitors', async (req, res) => {
    const visitors = await readData('visitors.json');
    const newVisitor = req.body.name ? req.body : {
        name: `Посетитель${Math.random().toString(36).slice(2)}`,
        age: 18 + Math.floor(Math.random() * 50),
        isMember: Math.random() > 0.5,
        visitDate: new Date().toISOString(),
        activities: ['Плавание']
    };
    visitors.push(newVisitor);
    await writeData('visitors.json', visitors);
    res.status(201).json(newVisitor);
});
app.put('/visitors/:id', async (req, res) => {
    const visitors = await readData('visitors.json');
    const updated = updateOrCreate(visitors, req.params.id, req.body);
    await writeData('visitors.json', updated);
    const item = findById(updated, req.params.id);
    res.json(item || { error: 'Not found' });
});
app.patch('/visitors/:id', async (req, res) => {
    const visitors = await readData('visitors.json');
    const visitor = findById(visitors, req.params.id);
    if (!visitor) return res.status(404).json({ error: 'Not found' });
    Object.assign(visitor, req.body, { age: 20 + Math.floor(Math.random() * 40) }); // Неидемпотентно!
    await writeData('visitors.json', visitors);
    res.json(visitor);
});
app.delete('/visitors/:id', async (req, res) => {
    const visitors = await readData('visitors.json');
    const idx = visitors.findIndex(v => v.id === Number(req.params.id));
    if (idx > -1) {
        visitors.splice(idx, 1);
        await writeData('visitors.json', visitors);
        res.json({ deleted: true });
    } else {
        res.status(404).json({ error: 'Not found' });
    }
});

app.get('/sessions', async (req, res) => {
    const sessions = await readData('sessions.json');
    res.json(sessions);
});
app.get('/sessions/:id', async (req, res) => {
    const sessions = await readData('sessions.json');
    const session = findById(sessions, req.params.id);
    session ? res.json(session) : res.status(404).json({ error: 'Session not found' });
});
app.post('/sessions', async (req, res) => {
    const sessions = await readData('sessions.json');
    const newSession = req.body.type ? req.body : {
        type: `Сеанс${Math.random().toString(36).slice(2)}`,
        duration: 30 + Math.floor(Math.random() * 60),
        isGroup: Math.random() > 0.3,
        startTime: new Date(Date.now() + Math.random() * 1e6).toISOString(),
        trainers: ['Тренер1']
    };
    sessions.push(newSession);
    await writeData('sessions.json', sessions);
    res.status(201).json(newSession);
});
app.put('/sessions/:id', async (req, res) => {
    const sessions = await readData('sessions.json');
    const updated = updateOrCreate(sessions, req.params.id, req.body);
    await writeData('sessions.json', updated);
    const item = findById(updated, req.params.id);
    res.json(item || { error: 'Not found' });
});
app.patch('/sessions/:id', async (req, res) => {
    const sessions = await readData('sessions.json');
    const session = findById(sessions, req.params.id);
    if (!session) return res.status(404).json({ error: 'Not found' });
    Object.assign(session, req.body, { duration: 30 + Math.floor(Math.random() * 60) }); // Неидемпотентно!
    await writeData('sessions.json', sessions);
    res.json(session);
});
app.delete('/sessions/:id', async (req, res) => {
    const sessions = await readData('sessions.json');
    const idx = sessions.findIndex(s => s.id === Number(req.params.id));
    if (idx > -1) {
        sessions.splice(idx, 1);
        await writeData('sessions.json', sessions);
        res.json({ deleted: true });
    } else {
        res.status(404).json({ error: 'Not found' });
    }
});

const server = app.listen(3000, () => {
    console.log('Server: http://localhost:3000');
});
