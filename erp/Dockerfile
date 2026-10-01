FROM frappe/erpnext:v16.37.0

USER frappe

# Copy custom app into bench apps
COPY --chown=frappe:frappe acs_erp /home/frappe/frappe-bench/apps/acs_erp

# Install app into bench virtualenv, register in apps.txt (ensuring newline), and link assets
RUN /home/frappe/frappe-bench/env/bin/pip install --no-cache-dir -e /home/frappe/frappe-bench/apps/acs_erp \
    && printf "\nacs_erp\n" >> /home/frappe/frappe-bench/sites/apps.txt \
    && ln -snf /home/frappe/frappe-bench/apps/acs_erp/acs_erp/public /home/frappe/frappe-bench/assets/acs_erp \
    && bench build --app acs_erp
