module.exports = {
  apps: [
    {
      name: 'portlore',
      script: './server/src/index.js',
      cwd: '/var/www/portlore',
      uid: 'portlore',
      gid: 'portlore',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: 'production',
        PORT: 3002,
      },
    },
  ],
};
