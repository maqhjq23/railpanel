cd /app || exit 1
php artisan tinker --execute="DB::table('settings')->where('key','settings::pterodactyl:auth:2fa_required')->update(['value' => '0']); echo '--- SETELAH UPDATE ---', PHP_EOL; print_r(DB::table('settings')->where('key','like','%2fa%')->get()->all());" 2>&1
