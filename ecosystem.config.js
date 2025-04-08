module.exports = {
  apps : [{
    name: 'raycast-favicons',
    script: './dist/bundle.js',
    instances: 1,
    max_memory_restart: '512M',
    env: {
      NODE_ENV: "production",
    },
    env_production: {
      NODE_ENV: "production",
    }
  }],
};
