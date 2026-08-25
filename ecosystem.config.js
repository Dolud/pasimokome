module.exports = {
  apps: [{
    name: 'marketing-dashboard',
    script: 'backend/server.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    error_file: '/var/log/marketing-dashboard-error.log',
    out_file: '/var/log/marketing-dashboard-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss'
  }]
};
