// Global State
let appData = {
    executive: null,
    customer: null,
    shipping: null,
    product: null,
    payment: null
};

// SQL Queries for Developer Tab
let currentSqlScripts = [];
let cmInstances = [];

// SQL Queries for Developer Tab
function generateSqlScripts(yearMonth) {
    let [year, month] = yearMonth.split('-').map(Number);
    
    // Current Month
    let currentStart = new Date(year, month - 1, 1);
    let currentEnd = new Date(year, month, 0);
    
    // Last Month
    let lastMonthStart = new Date(year, month - 2, 1);
    let lastMonthEnd = new Date(year, month - 1, 0);
    
    // Last Year
    let lastYearStart = new Date(year - 1, month - 1, 1);
    let lastYearEnd = new Date(year - 1, month, 0);
    
    // Format to YYYY-MM-DD
    const formatDate = (d) => {
        let m = (d.getMonth() + 1).toString().padStart(2, '0');
        let day = d.getDate().toString().padStart(2, '0');
        return \\-\-\\;
    };
    
    let curStartStr = formatDate(currentStart);
    let curEndStr = formatDate(currentEnd);
    let prevStartStr = formatDate(lastMonthStart);
    let prevEndStr = formatDate(lastMonthEnd);
    let yoyStartStr = formatDate(lastYearStart);
    let yoyEndStr = formatDate(lastYearEnd);
    
    // Format labels: "Apr 26"
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const formatLabel = (d) => \\ \\;
    
    let curLabel = formatLabel(currentStart);
    let prevLabel = formatLabel(lastMonthStart);
    let yoyLabel = formatLabel(lastYearStart);

    return [
        {
            title: "1. Master KPI Export (Revenue, Orders, AOV)",
            query: \SELECT 
    CASE 
        WHEN p.post_date >= '\ 00:00:00' AND p.post_date <= '\ 23:59:59' THEN '1. Current Month (\)'
        WHEN p.post_date >= '\ 00:00:00' AND p.post_date <= '\ 23:59:59' THEN '2. Last Month (\)'
        WHEN p.post_date >= '\ 00:00:00' AND p.post_date <= '\ 23:59:59' THEN '3. Last Year YoY (\)'
    END AS reporting_period,
    COUNT(DISTINCT p.ID) AS total_orders,
    SUM(pm.meta_value) AS total_revenue,
    SUM(pm.meta_value) / COUNT(DISTINCT p.ID) AS average_order_value
FROM wp_posts p
JOIN wp_postmeta pm ON p.ID = pm.post_id AND pm.meta_key = '_order_total'
WHERE p.post_type = 'shop_order' 
  AND p.post_status IN ('wc-completed', 'wc-processing')
  AND (
      (p.post_date >= '\ 00:00:00' AND p.post_date <= '\ 23:59:59') OR
      (p.post_date >= '\ 00:00:00' AND p.post_date <= '\ 23:59:59') OR
      (p.post_date >= '\ 00:00:00' AND p.post_date <= '\ 23:59:59')
  )
GROUP BY reporting_period
ORDER BY reporting_period;\
        },
        {
            title: "2. Customer Segmentation (Retail/Trade & Repeat Ratio)",
            query: \WITH FirstOrders AS (
    -- Step 1: Find the absolute first purchase date for every customer email
    SELECT 
        pm_email.meta_value AS customer_email,
        MIN(p.post_date) AS first_purchase_date
    FROM wp_posts p
    JOIN wp_postmeta pm_email ON p.ID = pm_email.post_id AND pm_email.meta_key = '_billing_email'
    WHERE p.post_type = 'shop_order' 
      AND p.post_status IN ('wc-completed', 'wc-processing')
    GROUP BY pm_email.meta_value
),
TargetOrders AS (
    -- Step 2: Grab all the orders for our 3 specific time buckets
    SELECT 
        p.ID AS order_id,
        CASE 
            WHEN p.post_date >= '\ 00:00:00' AND p.post_date <= '\ 23:59:59' THEN '1. Current Month (\)'
            WHEN p.post_date >= '\ 00:00:00' AND p.post_date <= '\ 23:59:59' THEN '2. Last Month (\)'
            WHEN p.post_date >= '\ 00:00:00' AND p.post_date <= '\ 23:59:59' THEN '3. Last Year YoY (\)'
        END AS reporting_period,
        CASE 
            WHEN p.post_date >= '\ 00:00:00' AND p.post_date <= '\ 23:59:59' THEN '\'
            WHEN p.post_date >= '\ 00:00:00' AND p.post_date <= '\ 23:59:59' THEN '\'
            WHEN p.post_date >= '\ 00:00:00' AND p.post_date <= '\ 23:59:59' THEN '\'
        END AS period_start_date,
        MAX(CASE WHEN pm.meta_key = '_order_total' THEN pm.meta_value END) AS total_amount,
        MAX(CASE WHEN pm.meta_key = '_billing_email' THEN pm.meta_value END) AS customer_email
    FROM wp_posts p
    JOIN wp_postmeta pm ON p.ID = pm.post_id
    WHERE p.post_type = 'shop_order' 
      AND p.post_status IN ('wc-completed', 'wc-processing')
      AND (
          (p.post_date >= '\ 00:00:00' AND p.post_date <= '\ 23:59:59') OR
          (p.post_date >= '\ 00:00:00' AND p.post_date <= '\ 23:59:59') OR
          (p.post_date >= '\ 00:00:00' AND p.post_date <= '\ 23:59:59')
      )
    GROUP BY p.ID, p.post_date
)
-- Step 3: Combine them and classify as New or Repeat based on the bucket's start date
SELECT 
    t.reporting_period,
    CASE 
        WHEN f.first_purchase_date < t.period_start_date THEN 'Repeat Customer'
        ELSE 'New Customer'
    END AS customer_type,
    COUNT(t.order_id) AS total_orders,
    SUM(t.total_amount) AS total_revenue,
    SUM(t.total_amount) / COUNT(t.order_id) AS average_order_value
FROM TargetOrders t
JOIN FirstOrders f ON t.customer_email = f.customer_email
GROUP BY t.reporting_period, customer_type
ORDER BY t.reporting_period, customer_type;\
        },
        {
            title: "3. Fulfillment & Shipping Analysis",
            query: \SELECT 
    CASE 
        WHEN p.post_date >= '\ 00:00:00' AND p.post_date <= '\ 23:59:59' THEN '1. Current Month (\)'
        WHEN p.post_date >= '\ 00:00:00' AND p.post_date <= '\ 23:59:59' THEN '2. Last Month (\)'
        WHEN p.post_date >= '\ 00:00:00' AND p.post_date <= '\ 23:59:59' THEN '3. Last Year YoY (\)'
    END AS reporting_period,
    woi.order_item_name AS shipping_method_name,
    COUNT(DISTINCT p.ID) AS total_orders,
    SUM(pm_total.meta_value) AS total_order_revenue,
    SUM(woim_cost.meta_value) AS total_shipping_revenue
FROM wp_posts p
JOIN wp_postmeta pm_total ON p.ID = pm_total.post_id AND pm_total.meta_key = '_order_total'
JOIN wp_woocommerce_order_items woi ON p.ID = woi.order_id AND woi.order_item_type = 'shipping'
LEFT JOIN wp_woocommerce_order_itemmeta woim_cost ON woi.order_item_id = woim_cost.order_item_id AND woim_cost.meta_key = 'cost'
WHERE p.post_type = 'shop_order'
  AND p.post_status NOT IN ('wc-pending', 'wc-cancelled', 'wc-refunded', 'wc-failed', 'trash', 'wc-trash')
  AND (
      (p.post_date >= '\ 00:00:00' AND p.post_date <= '\ 23:59:59') OR
      (p.post_date >= '\ 00:00:00' AND p.post_date <= '\ 23:59:59') OR
      (p.post_date >= '\ 00:00:00' AND p.post_date <= '\ 23:59:59')
  )
GROUP BY reporting_period, shipping_method_name
ORDER BY reporting_period, total_orders DESC;\
        },
        {
            title: "4. Product Performance Deep Dive",
            query: \SELECT
    COALESCE(NULLIF(var_p.post_title, ''), parent_p.post_title) AS \\\Product title\\\,
    pm_sku.meta_value AS \\\SKU\\\,

    sales.\\\\ Units\\\,
    sales.\\\\ N. Revenue\\\,
    sales.\\\\ Orders\\\,

    sales.\\\\ Units\\\,
    sales.\\\\ N. Revenue\\\,
    sales.\\\\ Orders\\\,

    sales.\\\\ Units\\\,
    sales.\\\\ N. Revenue\\\,
    sales.\\\\ Orders\\\,

    (
        SELECT GROUP_CONCAT(t.name SEPARATOR ', ')
        FROM wp_term_relationships tr
        JOIN wp_term_taxonomy tt
            ON tt.term_taxonomy_id = tr.term_taxonomy_id
           AND tt.taxonomy = 'product_cat'
        JOIN wp_terms t
            ON t.term_id = tt.term_id
        WHERE tr.object_id = sales.product_id
    ) AS \\\Category\\\

FROM (
    SELECT
        opl.product_id,
        opl.variation_id,

        SUM(
            CASE
                WHEN opl.date_created >= '\ 00:00:00'
                 AND opl.date_created <= '\ 23:59:59'
                THEN opl.product_qty
                ELSE 0
            END
        ) AS \\\\ Units\\\,

        SUM(
            CASE
                WHEN opl.date_created >= '\ 00:00:00'
                 AND opl.date_created <= '\ 23:59:59'
                THEN opl.product_net_revenue
                ELSE 0
            END
        ) AS \\\\ N. Revenue\\\,

        COUNT(
            DISTINCT CASE
                WHEN opl.date_created >= '\ 00:00:00'
                 AND opl.date_created <= '\ 23:59:59'
                THEN opl.order_id
            END
        ) AS \\\\ Orders\\\,


        SUM(
            CASE
                WHEN opl.date_created >= '\ 00:00:00'
                 AND opl.date_created <= '\ 23:59:59'
                THEN opl.product_qty
                ELSE 0
            END
        ) AS \\\\ Units\\\,

        SUM(
            CASE
                WHEN opl.date_created >= '\ 00:00:00'
                 AND opl.date_created <= '\ 23:59:59'
                THEN opl.product_net_revenue
                ELSE 0
            END
        ) AS \\\\ N. Revenue\\\,

        COUNT(
            DISTINCT CASE
                WHEN opl.date_created >= '\ 00:00:00'
                 AND opl.date_created <= '\ 23:59:59'
                THEN opl.order_id
            END
        ) AS \\\\ Orders\\\,


        SUM(
            CASE
                WHEN opl.date_created >= '\ 00:00:00'
                 AND opl.date_created <= '\ 23:59:59'
                THEN opl.product_qty
                ELSE 0
            END
        ) AS \\\\ Units\\\,

        SUM(
            CASE
                WHEN opl.date_created >= '\ 00:00:00'
                 AND opl.date_created <= '\ 23:59:59'
                THEN opl.product_net_revenue
                ELSE 0
            END
        ) AS \\\\ N. Revenue\\\,

        COUNT(
            DISTINCT CASE
                WHEN opl.date_created >= '\ 00:00:00'
                 AND opl.date_created <= '\ 23:59:59'
                THEN opl.order_id
            END
        ) AS \\\\ Orders\\\

    FROM wp_wc_order_product_lookup opl
    JOIN wp_wc_order_stats os
        ON os.order_id = opl.order_id

    WHERE os.status NOT IN ('wc-pending', 'wc-cancelled', 'wc-refunded', 'wc-failed', 'trash', 'wc-trash')
      AND (
            (
                opl.date_created >= '\ 00:00:00'
                AND opl.date_created <= '\ 23:59:59'
            )
         OR (
                opl.date_created >= '\ 00:00:00'
                AND opl.date_created <= '\ 23:59:59'
            )
         OR (
                opl.date_created >= '\ 00:00:00'
                AND opl.date_created <= '\ 23:59:59'
            )
      )

    GROUP BY
        opl.product_id,
        opl.variation_id

) AS sales

LEFT JOIN wp_posts parent_p
    ON parent_p.ID = sales.product_id

LEFT JOIN wp_posts var_p
    ON var_p.ID = sales.variation_id
   AND sales.variation_id > 0

LEFT JOIN wp_postmeta pm_sku
    ON pm_sku.post_id = CASE
        WHEN sales.variation_id > 0 THEN sales.variation_id
        ELSE sales.product_id
    END
   AND pm_sku.meta_key = '_sku'

ORDER BY
    sales.\\\\ N. Revenue\\\ DESC,
    sales.\\\\ N. Revenue\\\ DESC,
    sales.\\\\ N. Revenue\\\ DESC;\
        },
        {
            title: "5. Payment Gateway Distribution",
            query: \SELECT 
    COALESCE(pm_pay.meta_value, 'Unknown/Free') AS \\\Payment Gateway\\\,
    
    -- Current Month (\)
    COUNT(DISTINCT CASE WHEN p.post_date >= '\ 00:00:00' AND p.post_date <= '\ 23:59:59' THEN p.ID END) AS \\\\ Orders\\\,
    SUM(CASE WHEN p.post_date >= '\ 00:00:00' AND p.post_date <= '\ 23:59:59' THEN pm_total.meta_value ELSE 0 END) AS \\\\ Revenue\\\,
    
    -- Last Month (\)
    COUNT(DISTINCT CASE WHEN p.post_date >= '\ 00:00:00' AND p.post_date <= '\ 23:59:59' THEN p.ID END) AS \\\\ Orders\\\,
    SUM(CASE WHEN p.post_date >= '\ 00:00:00' AND p.post_date <= '\ 23:59:59' THEN pm_total.meta_value ELSE 0 END) AS \\\\ Revenue\\\,
    
    -- Last Year (\)
    COUNT(DISTINCT CASE WHEN p.post_date >= '\ 00:00:00' AND p.post_date <= '\ 23:59:59' THEN p.ID END) AS \\\\ Orders\\\,
    SUM(CASE WHEN p.post_date >= '\ 00:00:00' AND p.post_date <= '\ 23:59:59' THEN pm_total.meta_value ELSE 0 END) AS \\\\ Revenue\\\

FROM wp_posts p
JOIN wp_postmeta pm_total ON p.ID = pm_total.post_id AND pm_total.meta_key = '_order_total'
LEFT JOIN wp_postmeta pm_pay ON p.ID = pm_pay.post_id AND pm_pay.meta_key = '_payment_method_title'
WHERE p.post_type = 'shop_order'
  AND p.post_status NOT IN ('wc-pending', 'wc-cancelled', 'wc-refunded', 'wc-failed', 'trash', 'wc-trash')
  AND (
      (p.post_date >= '\ 00:00:00' AND p.post_date <= '\ 23:59:59') OR
      (p.post_date >= '\ 00:00:00' AND p.post_date <= '\ 23:59:59') OR
      (p.post_date >= '\ 00:00:00' AND p.post_date <= '\ 23:59:59')
  )
GROUP BY \\\Payment Gateway\\\
ORDER BY \\\\ Revenue\\\ DESC;\
        }
    ];
}

// Initialize the Application
document.addEventListener('DOMContentLoaded', function() {
    console.log("App Initialized v1.0.7");
    initTabs();
    initFileUpload();
    initSqlRepository();
    initGeminiIntegration();
    // Charts will render after data is uploaded
});

// Tab Navigation
function initTabs() {
    var tabBtns = document.querySelectorAll('.tab-btn');
    var tabContents = document.querySelectorAll('.tab-content');

    tabBtns.forEach(function(btn) {
        btn.addEventListener('click', function() {
            // Remove active from all tabs and content
            tabBtns.forEach(function(b) { b.classList.remove('active'); });
            tabContents.forEach(function(c) { c.classList.remove('active'); });

            // Add active to clicked tab
            btn.classList.add('active');

            // Show the matching content
            var targetId = btn.getAttribute('data-target');
            var targetEl = document.getElementById(targetId);
            if (targetEl) {
                targetEl.classList.add('active');
            }
        });
    });
}

// File Upload and Parsing
function initFileUpload() {
    var fileInput = document.getElementById('csvFileInput');
    var statusText = document.getElementById('uploadStatus');

    if (!fileInput) return;

    fileInput.addEventListener('change', function(e) {
        var files = e.target.files;
        if (files.length > 0) {
            statusText.textContent = `Processing ${files.length} file(s)...`;
            statusText.style.color = '#373737';
            
            let filesProcessed = 0;
            let datasetsFound = [];

            for (let i = 0; i < files.length; i++) {
                Papa.parse(files[i], {
                    header: true,
                    dynamicTyping: true,
                    skipEmptyLines: true,
                    complete: function(results) {
                        const fields = results.meta.fields;
                        const data = results.data;
                        
                        if (fields.includes('SKU') || fields.includes('Product title')) {
                            appData.product = data;
                            datasetsFound.push('Product');
                        } else if (fields.includes('Payment Gateway')) {
                            appData.payment = data;
                            datasetsFound.push('Payment');
                        } else if (fields.includes('shipping_method_name')) {
                            appData.shipping = data;
                            datasetsFound.push('Shipping');
                        } else if (fields.includes('customer_type')) {
                            appData.customer = data;
                            datasetsFound.push('Customer');
                        } else if (fields.includes('reporting_period') && fields.includes('average_order_value')) {
                            appData.executive = data;
                            datasetsFound.push('Executive');
                        }
                        
                        filesProcessed++;
                        if (filesProcessed === files.length) {
                            statusText.textContent = `Loaded ${datasetsFound.length} dataset(s): ${datasetsFound.join(', ')}`;
                            statusText.style.color = '#009640';
                            updateDashboards();
                        }
                    },
                    error: function(error) {
                        console.error("Error parsing " + files[i].name + ":", error);
                    }
                });
            }
        }
    });
}

function updateDashboards() {
    if (appData.executive) updateExecutiveDashboard();
    if (appData.customer) updateCustomerDashboard();
    if (appData.shipping) updateShippingDashboard();
    if (appData.product) updateProductDashboard();
    if (appData.payment) updatePaymentDashboard();
}

function updateExecutiveDashboard() {
    const data = appData.executive;
    if (!data || data.length === 0) return;

    let current = data.find(d => d.reporting_period && d.reporting_period.includes('1.'));
    let lastMonth = data.find(d => d.reporting_period && d.reporting_period.includes('2.'));
    
    if (current) {
        document.getElementById('kpi-revenue').textContent = 'Â£' + (current.total_revenue || 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
        document.getElementById('kpi-orders').textContent = (current.total_orders || 0).toLocaleString();
        document.getElementById('kpi-aov').textContent = 'Â£' + (current.average_order_value || 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});

        if (lastMonth) {
            let revTrend = ((current.total_revenue - lastMonth.total_revenue) / lastMonth.total_revenue) * 100;
            let ordTrend = ((current.total_orders - lastMonth.total_orders) / lastMonth.total_orders) * 100;
            let aovTrend = ((current.average_order_value - lastMonth.average_order_value) / lastMonth.average_order_value) * 100;
            
            updateTrendElement('kpi-revenue-trend', revTrend, 'MoM');
            updateTrendElement('kpi-orders-trend', ordTrend, 'MoM');
            updateTrendElement('kpi-aov-trend', aovTrend, 'MoM');
        }
    }
}

function updateTrendElement(id, value, suffix) {
    const el = document.getElementById(id);
    if (!el) return;
    if (value > 0) {
        el.textContent = `+${value.toFixed(1)}% ${suffix}`;
        el.className = 'kpi-trend trend-up';
    } else if (value < 0) {
        el.textContent = `${value.toFixed(1)}% ${suffix}`;
        el.className = 'kpi-trend trend-down';
    } else {
        el.textContent = `0% ${suffix}`;
        el.className = 'kpi-trend';
    }
}

function updateCustomerDashboard() {
    const data = appData.customer;
    if (!data || data.length === 0) return;

    let actualPeriods = [...new Set(data.map(d => d.reporting_period))].sort();

    let newRevenue = [];
    let repeatRevenue = [];
    let newAov = [];
    let repeatAov = [];
    
    let currentNewOrders = 0;
    let currentRepeatOrders = 0;

    actualPeriods.forEach(p => {
        let newRow = data.find(d => d.reporting_period === p && d.customer_type === 'New Customer');
        let repeatRow = data.find(d => d.reporting_period === p && d.customer_type === 'Repeat Customer');
        
        newRevenue.push(newRow ? newRow.total_revenue : 0);
        repeatRevenue.push(repeatRow ? repeatRow.total_revenue : 0);
        
        newAov.push(newRow ? newRow.average_order_value : 0);
        repeatAov.push(repeatRow ? repeatRow.average_order_value : 0);

        if (p.includes('1.')) {
            currentNewOrders = newRow ? newRow.total_orders : 0;
            currentRepeatOrders = repeatRow ? repeatRow.total_orders : 0;
        }
    });

    renderDonutChart('repeatNewOrdersChart', ['Repeat', 'New'], [currentRepeatOrders, currentNewOrders], ['#009640', '#FFE600']);

    renderStackedBarChart('customerRevenueChart', actualPeriods.map(p => p.substring(3)), 
        [{label: 'Repeat Customer', data: repeatRevenue, backgroundColor: '#009640'}, 
         {label: 'New Customer', data: newRevenue, backgroundColor: '#FFE600'}]);

    renderStackedBarChart('customerAovChart', actualPeriods.map(p => p.substring(3)), 
        [{label: 'Repeat AOV (Â£)', data: repeatAov, backgroundColor: '#009640'}, 
         {label: 'New AOV (Â£)', data: newAov, backgroundColor: '#FFE600'}]);
}

function updateShippingDashboard() {
    const data = appData.shipping;
    if (!data || data.length === 0) return;

    const currentData = data.filter(d => d.reporting_period && d.reporting_period.includes('1.'));
    
    let labels = currentData.map(d => d.shipping_method_name || 'Unknown');
    let volume = currentData.map(d => d.total_orders);
    let shippingRev = currentData.map(d => d.total_shipping_revenue);
    let orderRev = currentData.map(d => d.total_order_revenue);

    renderBarChart('fulfillmentVolumeChart', labels, volume, 'Orders', '#373737', 'x');
    renderBarChart('fulfillmentRevenueChart', labels, shippingRev, 'Shipping Revenue (Â£)', '#009640', 'x');
    renderBarChart('orderRevenueByMethodChart', labels, orderRev, 'Total Order Revenue (Â£)', '#FFE600', 'x');
}

function updateProductDashboard() {
    const data = appData.product;
    if (!data || data.length === 0) return;

    const keys = Object.keys(data[0]);
    const curRevKey = keys.find(k => k.includes('N. Revenue') && keys.indexOf(k) < 6); 
    const lastRevKey = keys.find(k => k.includes('N. Revenue') && keys.indexOf(k) > 5 && keys.indexOf(k) < 9); 
    
    if (!curRevKey) return;

    let sorted = [...data].sort((a, b) => (b[curRevKey] || 0) - (a[curRevKey] || 0));
    
    let tbody = document.querySelector('#topPerformersTable tbody');
    if (tbody) {
        tbody.innerHTML = '';
        sorted.slice(0, 5).forEach(row => {
            let tr = document.createElement('tr');
            tr.innerHTML = `<td>${row.SKU || ''}</td>
                            <td>${row['Product title'] || ''}</td>
                            <td>${row[keys[2]] || 0}</td>
                            <td>Â£${(row[curRevKey] || 0).toLocaleString()}</td>`;
            tbody.appendChild(tr);
        });
    }

    if (lastRevKey) {
        let movers = [...data].filter(r => r[lastRevKey] > 0).map(r => {
            return {
                ...r,
                growth: ((r[curRevKey] || 0) - r[lastRevKey]) / r[lastRevKey] * 100
            };
        }).sort((a, b) => b.growth - a.growth);

        let moversTbody = document.querySelector('#moversTable tbody');
        if (moversTbody) {
            moversTbody.innerHTML = '';
            movers.slice(0, 5).forEach(row => {
                let tr = document.createElement('tr');
                let growthColor = row.growth > 0 ? '#009640' : '#EF4444';
                let sign = row.growth > 0 ? '+' : '';
                tr.innerHTML = `<td>${row.SKU || ''}</td>
                                <td>${row['Product title'] || ''}</td>
                                <td style="color:${growthColor}">${sign}${row.growth.toFixed(1)}%</td>`;
                moversTbody.appendChild(tr);
            });
        }
    }

    let catRev = {};
    data.forEach(row => {
        let cat = row.Category || 'Uncategorized';
        catRev[cat] = (catRev[cat] || 0) + (row[curRevKey] || 0);
    });

    let catLabels = Object.keys(catRev).sort((a, b) => catRev[b] - catRev[a]).slice(0, 10);
    let catData = catLabels.map(l => catRev[l]);

    renderBarChart('categoryComparisonChart', catLabels, catData, 'GMV (Â£)', '#009640', 'y');
}

function updatePaymentDashboard() {
    const data = appData.payment;
    if (!data || data.length === 0) return;

    const keys = Object.keys(data[0]);
    const curOrdKey = keys[1];
    const curRevKey = keys[2];

    let labels = data.map(d => d['Payment Gateway']);
    let volume = data.map(d => d[curOrdKey] || 0);
    let revenue = data.map(d => d[curRevKey] || 0);

    renderPieChart('paymentVolumeChart', labels, volume);
    renderPieChart('paymentRevenueChart', labels, revenue);

    let tbody = document.querySelector('#paymentHistoryTable tbody');
    if (tbody) {
        tbody.innerHTML = '';
        data.forEach(row => {
            let tr = document.createElement('tr');
            tr.innerHTML = `<td>${row['Payment Gateway']}</td>
                            <td>${row[keys[1]] || 0}</td>
                            <td>Â£${(row[keys[2]] || 0).toLocaleString()}</td>
                            <td>${row[keys[3]] || 0}</td>
                            <td>Â£${(row[keys[4]] || 0).toLocaleString()}</td>`;
            tbody.appendChild(tr);
        });
    }
}

// Chart Builders
function renderDonutChart(canvasId, labels, data, colors) {
    var canvas = document.getElementById(canvasId);
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    if (window[canvasId] instanceof Chart) window[canvasId].destroy();
    window[canvasId] = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{ data: data, backgroundColor: colors, borderWidth: 0 }]
        },
        options: { responsive: true, maintainAspectRatio: false, cutout: '70%' }
    });
}

function renderPieChart(canvasId, labels, data) {
    var canvas = document.getElementById(canvasId);
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    if (window[canvasId] instanceof Chart) window[canvasId].destroy();
    window[canvasId] = new Chart(ctx, {
        type: 'pie',
        data: {
            labels: labels,
            datasets: [{ data: data, backgroundColor: ['#009640', '#FFE600', '#373737'], borderWidth: 0 }]
        },
        options: { responsive: true, maintainAspectRatio: false }
    });
}

function renderBarChart(canvasId, labels, data, datasetLabel, color, axis) {
    var canvas = document.getElementById(canvasId);
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    if (window[canvasId] instanceof Chart) window[canvasId].destroy();
    window[canvasId] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{ label: datasetLabel, data: data, backgroundColor: color }]
        },
        options: { responsive: true, maintainAspectRatio: false, indexAxis: axis || 'x' }
    });
}

function renderStackedBarChart(canvasId, labels, datasets) {
    var canvas = document.getElementById(canvasId);
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    if (window[canvasId] instanceof Chart) window[canvasId].destroy();
    window[canvasId] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: datasets
        },
        options: { 
            responsive: true, 
            maintainAspectRatio: false,
            scales: {
                x: { stacked: false },
                y: { stacked: false }
            }
        }
    });
}

// SQL Repository Implementation
function initSqlRepository() {
    var container = document.getElementById('sqlScriptsContainer');
    var monthSelector = document.getElementById('reportMonthSelector');
    if (!container || !monthSelector) return;

    function renderScripts() {
        let yearMonth = monthSelector.value || "2026-04";
        currentSqlScripts = generateSqlScripts(yearMonth);
        
        if (cmInstances.length === 0) {
            container.innerHTML = '';
            currentSqlScripts.forEach(function(script, index) {
                var block = document.createElement('div');
                block.className = 'sql-script-block';

                var header = document.createElement('div');
                header.className = 'sql-header';

                var title = document.createElement('h3');
                title.textContent = script.title;

                var copyBtn = document.createElement('button');
                copyBtn.className = 'btn-secondary copy-btn';
                copyBtn.setAttribute('data-index', index);
                copyBtn.textContent = 'Copy to Clipboard';

                header.appendChild(title);
                header.appendChild(copyBtn);

                var textarea = document.createElement('textarea');
                textarea.id = 'sql-editor-' + index;

                block.appendChild(header);
                block.appendChild(textarea);
                container.appendChild(block);

                let cm = CodeMirror.fromTextArea(document.getElementById('sql-editor-' + index), {
                    mode: "text/x-sql",
                    theme: "dracula",
                    readOnly: true,
                    lineNumbers: true,
                    lineWrapping: true
                });
                cm.setValue(script.query);
                cmInstances.push({ titleEl: title, cm: cm });
            });
        } else {
            currentSqlScripts.forEach(function(script, index) {
                cmInstances[index].titleEl.textContent = script.title;
                cmInstances[index].cm.setValue(script.query);
            });
        }
    }

    renderScripts();

    monthSelector.addEventListener('change', renderScripts);

    container.addEventListener('click', function(e) {
        if (e.target.classList.contains('copy-btn')) {
            var idx = e.target.getAttribute('data-index');
            navigator.clipboard.writeText(currentSqlScripts[idx].query).then(function() {
                var originalText = e.target.textContent;
                e.target.textContent = 'Copied!';
                e.target.style.backgroundColor = '#009640';
                e.target.style.color = '#fff';

                setTimeout(function() {
                    e.target.textContent = originalText;
                    e.target.style.backgroundColor = '#FFE600';
                    e.target.style.color = '#373737';
                }, 2000);
            });
        }
    });
}

// Gemini API Integration
function initGeminiIntegration() {
    var generateBtn = document.getElementById('generateInsightsBtn');
    var contentArea = document.getElementById('insightsContent');
    var apiKeyInput = document.getElementById('geminiApiKey');

    if (!generateBtn) return;

    generateBtn.addEventListener('click', function() {
        var apiKey = apiKeyInput.value.trim();
        if (!apiKey) {
            contentArea.innerHTML = '<p style="color: #EF4444;">Please enter a valid Gemini API key.</p>';
            return;
        }

        generateBtn.textContent = 'Generating...';
        generateBtn.disabled = true;
        contentArea.innerHTML = '<p>Analyzing Briants metrics...</p>';

        var prompt = "Act as a senior e-commerce analyst for Briants. Summarize performance based on: Revenue, Orders, AOV, Customer Split (Retail/Trade), Shipping (C&C/Delivery), and Product Categories (Fencing/Machinery). Keep it professional and concise (2 paragraphs).";

        fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=" + apiKey, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        })
        .then(function(response) { return response.json(); })
        .then(function(result) {
            if (result.error) throw new Error(result.error.message);
            var textResponse = result.candidates[0].content.parts[0].text;
            var paragraphs = textResponse.split('\n\n');
            var html = '';
            for (var i = 0; i < paragraphs.length; i++) {
                html += '<p>' + paragraphs[i] + '</p>';
            }
            contentArea.innerHTML = html;
        })
        .catch(function(error) {
            contentArea.innerHTML = '<p style="color: #EF4444;">Error: ' + error.message + '</p>';
        })
        .finally(function() {
            generateBtn.textContent = 'Generate Insights';
            generateBtn.disabled = false;
        });
    });
}

