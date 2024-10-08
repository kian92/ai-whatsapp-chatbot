const { spawn } = require('child_process');
const localtunnel = require('localtunnel');

// Start the dashboard and bot
const dashboard = spawn('npm', ['run', 'start:dashboard'], { stdio: 'inherit' });
const bot = spawn('npm', ['run', 'start:bot'], { stdio: 'inherit' });

// Create a tunnel for the dashboard
(async () => {
  const tunnel = await localtunnel({ port: 8080 });
  console.log('Public URL:', tunnel.url);

  tunnel.on('close', () => {
    console.log('Tunnel closed');
    process.exit(1);
  });
})();

// Handle process termination
process.on('SIGINT', () => {
  dashboard.kill();
  bot.kill();
  process.exit();
});