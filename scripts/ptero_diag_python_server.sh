cd /app || exit 1
echo "=== SERVERS ==="
php artisan tinker --execute="print_r(DB::table('servers')->select('id','uuid','name','egg_id','image','status')->get()->all());" 2>&1
echo ""
echo "=== EGGS (list) ==="
php artisan tinker --execute="foreach (DB::table('eggs')->select('id','name')->get() as \$e) { echo \$e->id.' | '.\$e->name.PHP_EOL; }" 2>&1
echo ""
echo "=== WINGS ERROR LOG (tail 35) ==="
tail -35 /var/log/pterodactyl/error.log 2>/dev/null
echo ""
echo "=== WINGS LOG (tail 20) ==="
tail -20 /var/log/pterodactyl/wings.log 2>/dev/null
