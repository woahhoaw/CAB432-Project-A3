// services/api/server.js
const app = require('./app/app'); // <-- see Dockerfile: we'll copy your app to /app/app
const PORT = Number(process.env.PORT) || 8080;

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`API listening on :${PORT}`);
});

process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down…');
  server.close(() => process.exit(0));
});
process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down…');
  server.close(() => process.exit(0));
});
