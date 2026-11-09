#!/bin/sh
# Installs the plugin in a throwaway WordPress (Docker: MariaDB + WordPress + WP-CLI) and checks the front
# end, settings validation, wp-admin and uninstall. Everything runs on a private Docker network on
# localhost:8089 and is removed at the end. Usage: sh scripts/verify-wordpress-plugin.sh
set -eu
cd "$(dirname "$0")/.."
N=ap-wp-test PORT=8089 KEY=pk_live_AbCdEfGhIjKlMnOpQrStUvWx
cleanup(){ docker rm -f $N-db $N-wp >/dev/null 2>&1 || true; docker network rm $N >/dev/null 2>&1 || true; }
trap cleanup EXIT; cleanup
docker network create $N >/dev/null
docker run -d --name $N-db --network $N -e MARIADB_ROOT_PASSWORD=root -e MARIADB_DATABASE=wp -e MARIADB_USER=wp -e MARIADB_PASSWORD=wp mariadb:11 >/dev/null
docker run -d --name $N-wp --network $N -p $PORT:80 -e WORDPRESS_DB_HOST=$N-db -e WORDPRESS_DB_USER=wp -e WORDPRESS_DB_PASSWORD=wp -e WORDPRESS_DB_NAME=wp \
  -v "$PWD/integrations/wordpress/automatepal:/var/www/html/wp-content/plugins/automatepal:ro" wordpress:6-php8.3-apache >/dev/null
wp(){ docker run --rm --network $N --volumes-from $N-wp --user 33:33 -e WORDPRESS_DB_HOST=$N-db -e WORDPRESS_DB_USER=wp -e WORDPRESS_DB_PASSWORD=wp -e WORDPRESS_DB_NAME=wp wordpress:cli wp "$@"; }
for i in $(seq 1 60); do wp core is-installed >/dev/null 2>&1 && break; wp db check >/dev/null 2>&1 && break; sleep 2; done
wp core install --url=http://localhost:$PORT --title=Shop --admin_user=admin --admin_password=admin-test-only --admin_email=admin@example.test --skip-email >/dev/null
fail(){ echo "FAIL: $1"; exit 1; }
n=0; ok(){ n=$((n+1)); }
wp plugin activate automatepal >/dev/null && ok
home=$(curl -s http://localhost:$PORT/)
echo "$home" | grep -q 'widget.js' && fail 'no key yet: nothing should load' || ok
wp option update automatepal_settings "{\"key\":\"$KEY\",\"app\":\"https://automatepal.com\",\"enabled\":\"1\"}" --format=json >/dev/null
home=$(curl -s http://localhost:$PORT/)
tag=$(echo "$home" | grep -o "<script[^>]*widget\.js[^>]*>" | head -1)
echo "$tag" | grep -q "src=\"https://automatepal.com/widget.js?bot=$KEY\"" || fail "front-end script src: $tag"; ok
echo "$tag" | grep -q 'async' || fail "script is async: $tag"; ok
[ "$(echo "$home" | grep -c 'widget.js')" = 1 ] || fail 'exactly one script'; ok
curl -s http://localhost:$PORT/wp-login.php | grep -q 'widget.js' && fail 'no script on wp-login' || ok
# Sanitising: bad key and bad app address keep the previous values; unchecked box turns it off.
r=$(wp eval 'echo json_encode(automatepal_sanitize(array("key"=>"sk_live_nope","app"=>"https://automatepal.com/evil","enabled"=>"1")));')
echo "$r" | grep -q "\"key\":\"$KEY\"" || fail "bad key kept old: $r"; echo "$r" | grep -q '"app":"https:\\/\\/automatepal.com"' || fail "bad app kept old: $r"; ok
r=$(wp eval 'echo json_encode(automatepal_sanitize(array("key"=>"pk_test_ZyXwVuTsRqPoNmLkJiHgFeDc","app"=>"https://chat.example.com/")));')
echo "$r" | grep -q '"key":"pk_test_ZyXwVuTsRqPoNmLkJiHgFeDc"' && echo "$r" | grep -q '"app":"https:\\/\\/chat.example.com"' && echo "$r" | grep -q '"enabled":"0"' || fail "valid input: $r"; ok
wp option update automatepal_settings "{\"key\":\"$KEY\",\"app\":\"https://automatepal.com\",\"enabled\":\"0\"}" --format=json >/dev/null
curl -s http://localhost:$PORT/ | grep -q 'widget.js' && fail 'turned off: nothing should load' || ok
wp plugin deactivate automatepal >/dev/null; wp plugin uninstall automatepal >/dev/null 2>&1 || true
# Mounted read-only, so WP cannot delete the files; uninstall.php still runs and removes the option.
wp option get automatepal_settings >/dev/null 2>&1 && fail 'option removed on uninstall' || ok
echo "PASS WordPress plugin: $n checks; real WordPress 6 + PHP 8.3: nothing without a key, one async footer script with ?bot=, none on wp-login, invalid key/app rejected, off switch, option removed on uninstall."
