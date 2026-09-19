echo "=== find artisan ==="
find / -maxdepth 4 -name artisan -type f 2>/dev/null | head -5
echo "=== nginx root ==="
grep -rh "root " /etc/nginx/ 2>/dev/null | grep -v "#" | head -5
echo "=== php-fpm cwd (proc) ==="
for p in $(pidof php-fpm php-fpm81 php-fpm82 2>/dev/null); do ls -l /proc/$p/cwd 2>/dev/null; break; done
echo "=== /app? ==="
ls /app 2>/dev/null | head -20
