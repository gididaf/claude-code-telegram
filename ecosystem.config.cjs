module.exports = {
  apps: [{
    name: 'claude-telegram-bot',
    script: './dist/index.js',
    autorestart: true,
    max_restarts: 10,
    restart_delay: 5000,
    watch: false,
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
  }]
};
