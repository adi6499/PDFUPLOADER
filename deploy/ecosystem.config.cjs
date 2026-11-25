// PM2 settings for the company server:  pm2 start deploy/ecosystem.config.cjs
module.exports = {
  apps: [{
    name: 'jinharsh-docs',
    script: 'server/server.mjs',
    cwd: __dirname + '/..',
    instances: 1,            // one process only: the document list is a single file
    exec_mode: 'fork',
    autorestart: true,
    max_memory_restart: '400M',
    env: { NODE_ENV: 'production' },
  }],
};
