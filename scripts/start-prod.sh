#!/bin/bash
set -a
source /home/admin/projects/sankengcloset_service/.env.production
set +a
exec node /home/admin/projects/sankengcloset_service/dist/src/server.js
