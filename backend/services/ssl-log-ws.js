const WebSocket = require('ws');
const jwt = require('jsonwebtoken');

class SslLogWebSocketService {
  constructor(server) {
    this.wss = new WebSocket.Server({
      server,
      path: '/api/ws-ssl-log'
    });
    this.subscribers = new Map();

    this.wss.on('connection', (ws, req) => {
      const url = new URL(req.url, 'http://localhost');
      const token = url.searchParams.get('token');
      const domainId = parseInt(url.searchParams.get('domainId'), 10);

      if (!token) {
        this.send(ws, { type: 'error', error: 'Missing token' });
        ws.close();
        return;
      }

      if (!Number.isInteger(domainId) || domainId <= 0) {
        this.send(ws, { type: 'error', error: 'Invalid domainId' });
        ws.close();
        return;
      }

      try {
        const user = jwt.verify(token, process.env.JWT_SECRET);
        ws.user = user;
        ws.domainId = domainId;
      } catch (err) {
        this.send(ws, { type: 'error', error: 'Invalid token' });
        ws.close();
        return;
      }

      const domainSubscribers = this.subscribers.get(domainId) || new Set();
      domainSubscribers.add(ws);
      this.subscribers.set(domainId, domainSubscribers);

      this.send(ws, {
        type: 'subscribed',
        domainId
      });

      ws.on('close', () => {
        this.removeSubscriber(ws);
      });

      ws.on('error', () => {
        this.removeSubscriber(ws);
      });
    });

    console.log('[WS-SSL] SSL 日志 WebSocket 已启动');
  }

  removeSubscriber(ws) {
    const domainId = ws.domainId;
    if (!domainId) return;

    const domainSubscribers = this.subscribers.get(domainId);
    if (!domainSubscribers) return;

    domainSubscribers.delete(ws);
    if (domainSubscribers.size === 0) {
      this.subscribers.delete(domainId);
    }
  }

  broadcast(domainId, payload) {
    const numericDomainId = parseInt(domainId, 10);
    if (!Number.isInteger(numericDomainId) || numericDomainId <= 0) return;

    const domainSubscribers = this.subscribers.get(numericDomainId);
    if (!domainSubscribers || domainSubscribers.size === 0) return;

    const message = JSON.stringify({
      type: 'ssl-log',
      domainId: numericDomainId,
      ...payload
    });

    for (const ws of domainSubscribers) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(message);
      }
    }
  }

  send(ws, data) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }
}

let sslLogWsService = null;

function initSslLogWebSocket(server) {
  if (!sslLogWsService) {
    sslLogWsService = new SslLogWebSocketService(server);
  }
  return sslLogWsService;
}

function broadcastSslLog(domainId, payload) {
  if (!sslLogWsService) return;
  sslLogWsService.broadcast(domainId, payload);
}

module.exports = {
  initSslLogWebSocket,
  broadcastSslLog
};
