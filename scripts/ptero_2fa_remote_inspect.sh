cd /app || exit 1
echo "=== SETTINGS TABLE ==="
php artisan tinker --execute="print_r(DB::table('settings')->get()->all());" 2>&1
echo ""
echo "=== USERS (2FA state) ==="
php artisan tinker --execute="print_r(DB::table('users')->select('id','email','username','root_admin','use_totp')->get()->all());" 2>&1
