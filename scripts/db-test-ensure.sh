#!/bin/sh
# Creates the app_test database if missing. Runs psql inside the container as
# POSTGRES_USER, so it follows whatever credentials Compose started Postgres with.
docker compose exec -T postgres sh -c '
  psql -U "$POSTGRES_USER" -d postgres -tc "SELECT 1 FROM pg_database WHERE datname = '"'"'app_test'"'"'" | grep -q 1 ||
  psql -U "$POSTGRES_USER" -d postgres -c "CREATE DATABASE app_test"
'
