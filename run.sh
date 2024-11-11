#!/bin/bash
export NODE_ENV=production
export DEBUG=main*
pm2 start ./src/index.js --name atm-xrpl-oracle --time