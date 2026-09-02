#!/data/data/com.termux/files/usr/bin/bash
cd /data/data/com.termux/files/home/downloads/new-project
python3 patch_payment.py
rm -f patch_payment.py run_patch.sh
npm run build
