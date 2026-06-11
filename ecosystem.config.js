module.exports = {
  apps: [
    {
      name: 'web-lady-api',
      script: 'dist/apps/api/apps/api/src/main.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'web-lady-workers',
      script: 'dist/apps/workers/apps/workers/src/main.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
