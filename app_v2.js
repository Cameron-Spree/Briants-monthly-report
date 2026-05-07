// Global State
let appData = {
    executive: null,
    customer: null,
    shipping: null,
    product: null,
    payment: null
};

let currentDashboardMonth = "";
let currentCompareMonth = "";

let currentSqlScripts = [];
let cmInstances = [];

// IndexedDB Persistence Wrapper
const DB_NAME = 'BriantsReportDB';
const DB_VERSION = 1;
const STORE_NAME = 'csvData';

function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
        };
        request.onsuccess = (e) => resolve(e.target.result);
        request.onerror = (e) => reject(e.target.error);
    });
}

async function saveAppDataToDB() {
    try {
        const db = await initDB();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.put(appData, 'appDataState');
        console.log('Saved appData to IndexedDB');
    } catch (e) {
        console.error('Failed to save to IndexedDB', e);
    }
}

async function loadAppDataFromDB() {
    try {
        const db = await initDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const request = store.get('appDataState');
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    } catch (e) {
        console.error('Failed to load from IndexedDB', e);
        return null;
    }
}


// SQL Queries for Developer Tab
function generateSqlScripts() {
    return [
        {
            title: "1. Master KPI Export (Revenue, Orders, AOV)",
            query: `SELECT 
    DATE_FORMAT(p.post_date, '%Y-%m') AS \`Reporting Month\`,
    COUNT(DISTINCT p.ID) AS total_orders,
    SUM(pm.meta_value) AS total_revenue,
    SUM(pm.meta_value) / COUNT(DISTINCT p.ID) AS average_order_value
FROM wp_posts p
JOIN wp_postmeta pm ON p.ID = pm.post_id AND pm.meta_key = '_order_total'
WHERE p.post_type = 'shop_order' 
  AND p.post_status NOT IN ('wc-pending', 'wc-cancelled', 'wc-refunded', 'wc-failed', 'trash', 'wc-trash')
  AND p.post_date >= DATE_SUB(CURDATE(), INTERVAL 24 MONTH)
GROUP BY \`Reporting Month\`
ORDER BY \`Reporting Month\` DESC;`
        },
        {
            title: "2. Customer Segmentation (Retail/Trade & Repeat Ratio)",
            query: `WITH FirstOrders AS (
    SELECT 
        pm_email.meta_value AS customer_email,
        MIN(p.post_date) AS first_purchase_date
    FROM wp_posts p
    JOIN wp_postmeta pm_email ON p.ID = pm_email.post_id AND pm_email.meta_key = '_billing_email'
    WHERE p.post_type = 'shop_order' 
      AND p.post_status NOT IN ('wc-pending', 'wc-cancelled', 'wc-refunded', 'wc-failed', 'trash', 'wc-trash')
    GROUP BY pm_email.meta_value
),
TargetOrders AS (
    SELECT 
        p.ID AS order_id,
        DATE_FORMAT(p.post_date, '%Y-%m') AS \`Reporting Month\`,
        p.post_date,
        MAX(CASE WHEN pm.meta_key = '_order_total' THEN pm.meta_value END) AS total_amount,
        MAX(CASE WHEN pm.meta_key = '_billing_email' THEN pm.meta_value END) AS customer_email
    FROM wp_posts p
    JOIN wp_postmeta pm ON p.ID = pm.post_id
    WHERE p.post_type = 'shop_order' 
      AND p.post_status NOT IN ('wc-pending', 'wc-cancelled', 'wc-refunded', 'wc-failed', 'trash', 'wc-trash')
      AND p.post_date >= DATE_SUB(CURDATE(), INTERVAL 24 MONTH)
    GROUP BY p.ID, p.post_date
)
SELECT 
    t.\`Reporting Month\`,
    CASE 
        WHEN f.first_purchase_date < t.post_date THEN 'Repeat Customer'
        ELSE 'New Customer'
    END AS customer_type,
    COUNT(t.order_id) AS total_orders,
    SUM(t.total_amount) AS total_revenue,
    SUM(t.total_amount) / COUNT(t.order_id) AS average_order_value
FROM TargetOrders t
JOIN FirstOrders f ON t.customer_email = f.customer_email
GROUP BY t.\`Reporting Month\`, customer_type
ORDER BY t.\`Reporting Month\` DESC, customer_type;`
        },
        {
            title: "3. Fulfillment & Shipping Analysis",
            query: `SELECT 
    DATE_FORMAT(p.post_date, '%Y-%m') AS \`Reporting Month\`,
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
  AND p.post_date >= DATE_SUB(CURDATE(), INTERVAL 24 MONTH)
GROUP BY \`Reporting Month\`, shipping_method_name
ORDER BY \`Reporting Month\` DESC, total_orders DESC;`
        },
        {
            title: "4. Product Performance Deep Dive",
            query: `SELECT
    DATE_FORMAT(opl.date_created, '%Y-%m') AS \`Reporting Month\`,
    COALESCE(NULLIF(var_p.post_title, ''), parent_p.post_title) AS \`Product title\`,
    pm_sku.meta_value AS \`SKU\`,
    SUM(opl.product_qty) AS \`Units\`,
    SUM(opl.product_net_revenue) AS \`N. Revenue\`,
    COUNT(DISTINCT opl.order_id) AS \`Orders\`,
    (
        SELECT GROUP_CONCAT(t.name SEPARATOR ', ')
        FROM wp_term_relationships tr
        JOIN wp_term_taxonomy tt
            ON tt.term_taxonomy_id = tr.term_taxonomy_id
           AND tt.taxonomy = 'product_cat'
        JOIN wp_terms t
            ON t.term_id = tt.term_id
        WHERE tr.object_id = opl.product_id
    ) AS \`Category\`
FROM wp_wc_order_product_lookup opl
JOIN wp_wc_order_stats os
    ON os.order_id = opl.order_id
LEFT JOIN wp_posts parent_p
    ON parent_p.ID = opl.product_id
LEFT JOIN wp_posts var_p
    ON var_p.ID = opl.variation_id
   AND opl.variation_id > 0
LEFT JOIN wp_postmeta pm_sku
    ON pm_sku.post_id = CASE
        WHEN opl.variation_id > 0 THEN opl.variation_id
        ELSE opl.product_id
    END
   AND pm_sku.meta_key = '_sku'
WHERE os.status NOT IN ('wc-pending', 'wc-cancelled', 'wc-refunded', 'wc-failed', 'trash', 'wc-trash')
  AND opl.date_created >= DATE_SUB(CURDATE(), INTERVAL 24 MONTH)
GROUP BY
    \`Reporting Month\`,
    opl.product_id,
    opl.variation_id
ORDER BY
    \`Reporting Month\` DESC,
    \`N. Revenue\` DESC;`
        },
        {
            title: "5. Payment Gateway Distribution",
            query: `SELECT 
    DATE_FORMAT(p.post_date, '%Y-%m') AS \`Reporting Month\`,
    COALESCE(pm_pay.meta_value, 'Unknown/Free') AS \`Payment Gateway\`,
    COUNT(DISTINCT p.ID) AS \`Orders\`,
    SUM(pm_total.meta_value) AS \`Revenue\`
FROM wp_posts p
JOIN wp_postmeta pm_total ON p.ID = pm_total.post_id AND pm_total.meta_key = '_order_total'
LEFT JOIN wp_postmeta pm_pay ON p.ID = pm_pay.post_id AND pm_pay.meta_key = '_payment_method_title'
WHERE p.post_type = 'shop_order'
  AND p.post_status NOT IN ('wc-pending', 'wc-cancelled', 'wc-refunded', 'wc-failed', 'trash', 'wc-trash')
  AND p.post_date >= DATE_SUB(CURDATE(), INTERVAL 24 MONTH)
GROUP BY \`Reporting Month\`, \`Payment Gateway\`
ORDER BY \`Reporting Month\` DESC, \`Revenue\` DESC;`
        }
    ];
}

// Initialize the Application
document.addEventListener('DOMContentLoaded', async function() {
    console.log("App Initialized v1.2.0");
    initTabs();
    initFileUpload();
    initSqlRepository();
    initGeminiIntegration();
    
    // Initialize Global Date Filter
    const dateFilter = document.getElementById('globalDateFilter');
    const compareFilter = document.getElementById('compareDateFilter');
    if (dateFilter && compareFilter) {
        const now = new Date();
        const m = (now.getMonth() + 1).toString().padStart(2, '0');
        dateFilter.value = `${now.getFullYear()}-${m}`;
        currentDashboardMonth = dateFilter.value;
        
        let prevM = now.getMonth();
        let prevY = now.getFullYear();
        if (prevM === 0) { prevM = 12; prevY--; }
        compareFilter.value = `${prevY}-${prevM.toString().padStart(2, '0')}`;
        currentCompareMonth = compareFilter.value;

        dateFilter.addEventListener('change', (e) => {
            currentDashboardMonth = e.target.value;
            updateDashboards();
        });
        
        compareFilter.addEventListener('change', (e) => {
            currentCompareMonth = e.target.value;
            updateDashboards();
        });
    }
    
    // Load from IndexedDB on startup
    const savedData = await loadAppDataFromDB();
    if (savedData && (savedData.executive || savedData.customer || savedData.shipping || savedData.product || savedData.payment)) {
        appData = savedData;
        console.log("Loaded data from IndexedDB", appData);
        updateDashboards();
    }
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
                    transform: function(value) {
                        if (typeof value === 'string') {
                            return value.replace(/Ã‚/g, '').trim();
                        }
                        return value;
                    },
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
                        } else if (fields.includes('Reporting Month') && fields.includes('average_order_value')) {
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
    
    // Save to IndexedDB after rendering
    saveAppDataToDB();
}

function getComparisonMonths(targetMonthStr) {
    if (!targetMonthStr) {
        const now = new Date();
        let m = (now.getMonth() + 1).toString().padStart(2, '0');
        targetMonthStr = `${now.getFullYear()}-${m}`;
    }
    let [year, month] = targetMonthStr.split('-').map(Number);
    
    let currentStart = new Date(year, month - 1, 1);
    
    let lastMonthStart;
    if (currentCompareMonth) {
        let [cYear, cMonth] = currentCompareMonth.split('-').map(Number);
        lastMonthStart = new Date(cYear, cMonth - 1, 1);
    } else {
        lastMonthStart = new Date(year, month - 2, 1);
    }
    
    let lastYearStart = new Date(year - 1, month - 1, 1);
    
    const formatYm = (d) => {
        let m = (d.getMonth() + 1).toString().padStart(2, '0');
        return `${d.getFullYear()}-${m}`;
    };

    const formatLabel = (d) => {
        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        return `${monthNames[d.getMonth()]} ${d.getFullYear().toString().substring(2)}`;
    };
    
    return {
        current: formatYm(currentStart),
        last: formatYm(lastMonthStart),
        yoy: formatYm(lastYearStart),
        curLabel: formatLabel(currentStart),
        prevLabel: formatLabel(lastMonthStart),
        yoyLabel: formatLabel(lastYearStart)
    };
}

function updateExecutiveDashboard() {
    const data = appData.executive;
    if (!data || data.length === 0) return;

    let { current, last } = getComparisonMonths(currentDashboardMonth);
    let currRow = data.find(d => d['Reporting Month'] === current);
    let prevRow = data.find(d => d['Reporting Month'] === last);
    
    if (currRow) {
        document.getElementById('kpi-revenue').textContent = '£' + (currRow.total_revenue || 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
        document.getElementById('kpi-orders').textContent = (currRow.total_orders || 0).toLocaleString();
        document.getElementById('kpi-aov').textContent = '£' + (currRow.average_order_value || 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});

        if (prevRow) {
            let revTrend = ((currRow.total_revenue - prevRow.total_revenue) / prevRow.total_revenue) * 100;
            let ordTrend = ((currRow.total_orders - prevRow.total_orders) / prevRow.total_orders) * 100;
            let aovTrend = ((currRow.average_order_value - prevRow.average_order_value) / prevRow.average_order_value) * 100;
            
            updateTrendElement('kpi-revenue-trend', revTrend, 'MoM');
            updateTrendElement('kpi-orders-trend', ordTrend, 'MoM');
            updateTrendElement('kpi-aov-trend', aovTrend, 'MoM');
        } else {
            updateTrendElement('kpi-revenue-trend', 0, 'MoM');
            updateTrendElement('kpi-orders-trend', 0, 'MoM');
            updateTrendElement('kpi-aov-trend', 0, 'MoM');
        }
    } else {
        document.getElementById('kpi-revenue').textContent = '--';
        document.getElementById('kpi-orders').textContent = '--';
        document.getElementById('kpi-aov').textContent = '--';
        updateTrendElement('kpi-revenue-trend', 0, 'MoM');
        updateTrendElement('kpi-orders-trend', 0, 'MoM');
        updateTrendElement('kpi-aov-trend', 0, 'MoM');
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

    let { current, last, yoy, curLabel, prevLabel, yoyLabel } = getComparisonMonths(currentDashboardMonth);
    
    let periods = [yoy, last, current];
    let labels = [yoyLabel, prevLabel, curLabel];

    let newRevenue = [];
    let repeatRevenue = [];
    let newAov = [];
    let repeatAov = [];
    
    let currentNewOrders = 0;
    let currentRepeatOrders = 0;

    periods.forEach(p => {
        let newRow = data.find(d => d['Reporting Month'] === p && d.customer_type === 'New Customer');
        let repeatRow = data.find(d => d['Reporting Month'] === p && d.customer_type === 'Repeat Customer');
        
        newRevenue.push(newRow ? newRow.total_revenue : 0);
        repeatRevenue.push(repeatRow ? repeatRow.total_revenue : 0);
        
        newAov.push(newRow ? newRow.average_order_value : 0);
        repeatAov.push(repeatRow ? repeatRow.average_order_value : 0);

        if (p === current) {
            currentNewOrders = newRow ? newRow.total_orders : 0;
            currentRepeatOrders = repeatRow ? repeatRow.total_orders : 0;
        }
    });

    renderDonutChart('repeatNewOrdersChart', ['Repeat', 'New'], [currentRepeatOrders, currentNewOrders], ['#009640', '#FFE600']);

    renderStackedBarChart('customerRevenueChart', labels, 
        [{label: 'Repeat Customer', data: repeatRevenue, backgroundColor: '#009640'}, 
         {label: 'New Customer', data: newRevenue, backgroundColor: '#FFE600'}]);

    renderStackedBarChart('customerAovChart', labels, 
        [{label: 'Repeat AOV (£)', data: repeatAov, backgroundColor: '#009640'}, 
         {label: 'New AOV (£)', data: newAov, backgroundColor: '#FFE600'}]);
}

function updateShippingDashboard() {
    const data = appData.shipping;
    if (!data || data.length === 0) return;

    let { current } = getComparisonMonths(currentDashboardMonth);
    const currentData = data.filter(d => d['Reporting Month'] === current);
    
    let labels = currentData.map(d => d.shipping_method_name || 'Unknown');
    let volume = currentData.map(d => d.total_orders);
    let shippingRev = currentData.map(d => d.total_shipping_revenue);
    let orderRev = currentData.map(d => d.total_order_revenue);

    renderBarChart('fulfillmentVolumeChart', labels, volume, 'Orders', '#373737', 'x');
    renderBarChart('fulfillmentRevenueChart', labels, shippingRev, 'Shipping Revenue (£)', '#009640', 'x');
    renderBarChart('orderRevenueByMethodChart', labels, orderRev, 'Total Order Revenue (£)', '#FFE600', 'x');
}

function updateProductDashboard() {
    const data = appData.product;
    if (!data || data.length === 0) return;

    let { current, last } = getComparisonMonths(currentDashboardMonth);
    const currentData = data.filter(d => d['Reporting Month'] === current);
    const lastData = data.filter(d => d['Reporting Month'] === last);
    
    let sorted = [...currentData].sort((a, b) => (b['N. Revenue'] || 0) - (a['N. Revenue'] || 0));
    
    let tbody = document.querySelector('#topPerformersTable tbody');
    if (tbody) {
        tbody.innerHTML = '';
        sorted.slice(0, 5).forEach(row => {
            let tr = document.createElement('tr');
            tr.innerHTML = `<td>${row.SKU || ''}</td>
                            <td>${row['Product title'] || ''}</td>
                            <td>${row['Units'] || 0}</td>
                            <td>£${(row['N. Revenue'] || 0).toLocaleString()}</td>`;
            tbody.appendChild(tr);
        });
    }

    let movers = sorted.map(currRow => {
        let prevRow = lastData.find(r => r.SKU === currRow.SKU) || {};
        let lastRev = prevRow['N. Revenue'] || 0;
        let growth = lastRev > 0 ? ((currRow['N. Revenue'] - lastRev) / lastRev) * 100 : 0;
        return {
            sku: currRow.SKU,
            title: currRow['Product title'],
            growth: growth,
            curRev: currRow['N. Revenue']
        };
    }).filter(m => m.growth > 0 && m.curRev > 0).sort((a, b) => b.growth - a.growth);

    let moversTbody = document.querySelector('#moversShakersTable tbody');
    if (moversTbody) {
        moversTbody.innerHTML = '';
        movers.slice(0, 5).forEach(row => {
            let tr = document.createElement('tr');
            tr.innerHTML = `<td>${row.sku || ''}</td>
                            <td>${row.title || ''}</td>
                            <td style="color: #009640; font-weight: bold;">+${row.growth.toFixed(1)}%</td>`;
            moversTbody.appendChild(tr);
        });
    }
    
    // Setup Product Trend Chart
    let selector = document.getElementById('productTrendSelector');
    if (selector) {
        // Extract unique products
        let uniqueProducts = new Map();
        data.forEach(d => {
            if (d.SKU && !uniqueProducts.has(d.SKU)) {
                uniqueProducts.set(d.SKU, d['Product title']);
            }
        });
        
        let skus = Array.from(uniqueProducts.keys()).sort();
        
        // Preserve current selection if exists
        let currentSelection = selector.value;
        
        selector.innerHTML = '<option value="">Select a product...</option>';
        skus.forEach(sku => {
            let opt = document.createElement('option');
            opt.value = sku;
            opt.textContent = `[${sku}] ${uniqueProducts.get(sku)}`;
            selector.appendChild(opt);
        });
        
        if (currentSelection && uniqueProducts.has(currentSelection)) {
            selector.value = currentSelection;
        } else if (skus.length > 0 && !selector.value) {
            selector.value = skus[0]; // default to first product
        }
        
        // Render chart
        renderProductTrend(selector.value, data);
        
        // Update on change
        selector.onchange = (e) => {
            renderProductTrend(e.target.value, data);
        };
    }
}

function renderProductTrend(sku, data) {
    if (!sku) return;
    
    // Get all unique reporting months sorted chronologically
    let allMonths = [...new Set(data.map(d => d['Reporting Month']))].filter(Boolean).sort();
    
    let chartData = [];
    allMonths.forEach(m => {
        let row = data.find(d => d['Reporting Month'] === m && d.SKU === sku);
        chartData.push(row ? (row['N. Revenue'] || 0) : 0);
    });
    
    renderLineChart('productTrendChart', allMonths, {
        label: 'Net Revenue (£)',
        data: chartData,
        color: '#009640'
    });
}

function updatePaymentDashboard() {
    const data = appData.payment;
    if (!data || data.length === 0) return;

    let { current, last } = getComparisonMonths(currentDashboardMonth);

    const currentData = data.filter(d => d['Reporting Month'] === current);
    
    let labels = currentData.map(d => d['Payment Gateway']);
    let revenue = currentData.map(d => d['Revenue']);
    
    renderPieChart('paymentPieChart', labels, revenue);

    let tbody = document.querySelector('#paymentHistoryTable tbody');
    if (tbody) {
        tbody.innerHTML = '';
        currentData.forEach(row => {
            let gw = row['Payment Gateway'];
            let lastRow = data.find(d => d['Reporting Month'] === last && d['Payment Gateway'] === gw) || {};
            
            let tr = document.createElement('tr');
            tr.innerHTML = `<td>${gw}</td>
                            <td>${row.Orders || 0}</td>
                            <td>£${(row.Revenue || 0).toLocaleString()}</td>
                            <td>${lastRow.Orders || 0}</td>
                            <td>£${(lastRow.Revenue || 0).toLocaleString()}</td>`;
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

function renderLineChart(canvasId, labels, dataObj) {
    var canvas = document.getElementById(canvasId);
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    if (window[canvasId] instanceof Chart) window[canvasId].destroy();
    
    window[canvasId] = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: dataObj.label,
                data: dataObj.data,
                borderColor: dataObj.color || '#009640',
                backgroundColor: 'rgba(0, 150, 64, 0.1)',
                fill: true,
                tension: 0.3,
                borderWidth: 2,
                pointBackgroundColor: dataObj.color || '#009640'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true
                }
            }
        }
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
    if (!container) return;

    function renderScripts() {
        currentSqlScripts = generateSqlScripts();
        
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




