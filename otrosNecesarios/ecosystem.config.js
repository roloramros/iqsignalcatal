module.exports = {
  apps: [
    {
      name: 'iqsignal-web',
      script: '/root/iqSignalCatal/index.js',
      cwd: '/root/iqSignalCatal',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      error_file: '/root/logs/iqsignal-err.log',
      out_file: '/root/logs/iqsignal-out.log'
    }
  ]
};
