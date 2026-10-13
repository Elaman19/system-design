#!/bin/sh
# Recreates the app_test database empty, so migrations always run from scratch.
# Runs psql inside the container as POSTGRES_USER, so it follows whatever
# credentials Compose started Postgres with.
docker compose exec -T postgres sh -c '
  psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 \
    -c "DROP DATABASE IF EXISTS app_test WITH (FORCE)" \
    -c "CREATE DATABASE app_test"
'
