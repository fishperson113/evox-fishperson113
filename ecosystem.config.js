/**
 * PM2 Ecosystem Config — Agent Process Management
 *
 * Usage:
 *   pm2 start ecosystem.config.js
 *   pm2 status
 *   pm2 logs
 *   pm2 restart all
 *   pm2 stop all
 *
 * Auto-restart on crash + boot:
 *   pm2 save
 *   pm2 startup
 */

module.exports = {
  apps: [
    {
      name: 'sam',
      script: './scripts/agent-loop.sh',
      args: 'sam',
      interpreter: '/bin/bash',
      cwd: '/Users/sonpiaz/evox',
      autorestart: true,
      watch: false,
      max_restarts: 10,
      restart_delay: 5000, // 5 seconds between restarts
      env: {
        AGENT: 'sam',
        CONVEX_URL: 'https://gregarious-elk-556.convex.site',
      },
      error_file: './logs/sam-error.log',
      out_file: './logs/sam-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
    {
      name: 'leo',
      script: './scripts/agent-loop.sh',
      args: 'leo',
      interpreter: '/bin/bash',
      cwd: '/Users/sonpiaz/evox',
      autorestart: true,
      watch: false,
      max_restarts: 10,
      restart_delay: 5000,
      env: {
        AGENT: 'leo',
        CONVEX_URL: 'https://gregarious-elk-556.convex.site',
      },
      error_file: './logs/leo-error.log',
      out_file: './logs/leo-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
    {
      name: 'max',
      script: './scripts/agent-loop.sh',
      args: 'max',
      interpreter: '/bin/bash',
      cwd: '/Users/sonpiaz/evox',
      autorestart: true,
      watch: false,
      max_restarts: 10,
      restart_delay: 5000,
      env: {
        AGENT: 'max',
        CONVEX_URL: 'https://gregarious-elk-556.convex.site',
      },
      error_file: './logs/max-error.log',
      out_file: './logs/max-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
