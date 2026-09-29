const { handler } = require('./send-audit-image');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ ok: false, error: 'GET required' }) };
  }
  const q = event.queryStringParameters || {};
  return handler({
    httpMethod: 'POST',
    body: JSON.stringify({
      secret: q.key || '',
      chat_id: q.chat_id || '',
      thread_id: Number(q.thread_id || 0),
      caption: q.caption || '',
      text: q.text || '',
    }),
  });
};
