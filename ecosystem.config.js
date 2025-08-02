module.exports = {
  apps: [
    {
      name: "viv-final",
      script: "./src/server.js",
      watch: true,
      interpreter: "node",
      node_args: "--experimental-specifier-resolution=node"
    }
  ],
};
