// PM2 settings for the company server:  pm2 start deploy/ecosystem.config.cjs
module.exports = {
  apps: [{
    name: 'jinharsh-docs',
    script: 'server/server.mjs',
    cwd: __dirname + '/..',
    instances: 1,            // one process only: the document list is a single file
    exec_mode: 'fork',
    autorestart: true,
    // measured with tools/bench-memory.mjs: about 60 MB resting, up to ~190 MB under heavy use (1,000 page views,
    // 30 downloads at once, a 150 MB upload, two years of visitor history); fine on a 512 MB server
    node_args: '--max-old-space-size=192',
    max_memory_restart: '300M',
    env: { NODE_ENV: 'production' },
  }],
};
