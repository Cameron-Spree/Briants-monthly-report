// Global State
let appData = {
    executive: null,
    customer: null,
    shipping: null,
    product: null,
    payment: null,
    basket: null,
    categoryHierarchy: null,
    basketProject: null,
    basketConsumables: null,
    basketAnchors: null,
    basketCrossCategory: null,
    uploadMeta: {}
};
let dateRangeFrom = "";
let dateRangeTo = "";

// Per-tab comparison month state
let customerMonthA = "";
let customerMonthB = "";
let shippingMonthA = "";
let shippingMonthB = "";
let paymentMonthA = "";
let paymentMonthB = "";
let productTableMonthA = "";
let productTableMonthB = "";
let categoryTableMonthA = "";
let categoryTableMonthB = "";

// Table sort state
let productSortA = { col: 'revenue', dir: 'desc' };
let productSortB = { col: 'revenue', dir: 'desc' };
let categorySortA = { col: 'revenue', dir: 'desc' };
let categorySortB = { col: 'revenue', dir: 'desc' };

let currentSqlScripts = [];
let cmInstances = [];
let categoryHierarchyLookupCache = { source: null, byName: null };

// Register ChartJS datalabels plugin
Chart.register(ChartDataLabels);
Chart.defaults.set('plugins.datalabels', {
    display: function(context) {
        return context.dataset.data[context.dataIndex] > 0;
    },
    color: '#373737',
    font: { size: 10, weight: 600 },
    anchor: 'end',
    align: 'top'
});

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
        },
        {
            title: "6. Market Basket Analysis (Cross-Selling)",
            query: `SELECT
    COALESCE(NULLIF(var_p1.post_title, ''), parent_p1.post_title) AS \`Product A\`,
    COALESCE(NULLIF(var_p2.post_title, ''), parent_p2.post_title) AS \`Product B\`,
    COUNT(DISTINCT opl1.order_id) AS \`Times Bought Together\`
FROM wp_wc_order_product_lookup opl1
JOIN wp_wc_order_product_lookup opl2 ON opl1.order_id = opl2.order_id 
    AND CASE WHEN opl1.variation_id > 0 THEN opl1.variation_id ELSE opl1.product_id END < CASE WHEN opl2.variation_id > 0 THEN opl2.variation_id ELSE opl2.product_id END
JOIN wp_wc_order_stats os ON os.order_id = opl1.order_id
LEFT JOIN wp_posts parent_p1 ON parent_p1.ID = opl1.product_id
LEFT JOIN wp_posts var_p1 ON var_p1.ID = opl1.variation_id AND opl1.variation_id > 0
LEFT JOIN wp_posts parent_p2 ON parent_p2.ID = opl2.product_id
LEFT JOIN wp_posts var_p2 ON var_p2.ID = opl2.variation_id AND opl2.variation_id > 0
WHERE os.status NOT IN ('wc-pending', 'wc-cancelled', 'wc-refunded', 'wc-failed', 'trash', 'wc-trash')
  AND opl1.date_created >= DATE_SUB(CURDATE(), INTERVAL 24 MONTH)
GROUP BY \`Product A\`, \`Product B\`
HAVING \`Times Bought Together\` > 2
ORDER BY \`Times Bought Together\` DESC;`
        },
        {
            title: "7. Category Hierarchy Export",
            query: `SELECT
    t.term_id AS \`Category ID\`,
    t.name AS \`Category Name\`,
    t.slug AS \`Slug\`,
    tt.parent AS \`Parent ID\`,
    (SELECT name FROM wp_terms WHERE term_id = tt.parent) AS \`Parent Name\`
FROM
    wp_terms t
INNER JOIN
    wp_term_taxonomy tt ON t.term_id = tt.term_id
WHERE
    tt.taxonomy = 'product_cat'
ORDER BY
    tt.parent ASC;`
        },
        {
            title: "8. Project vs. Maintenance Baskets",
            query: `SELECT 
    \`Reporting Month\`,
    \`Basket Type\`,
    COUNT(order_id) AS \`Total Baskets\`,
    SUM(order_revenue) AS \`Total Revenue\`,
    SUM(order_revenue) / COUNT(order_id) AS \`Average Order Value\`
FROM (
    -- STEP 1: Tag each individual order as Project or Maintenance
    SELECT 
        os.order_id,
        DATE_FORMAT(os.date_created, '%Y-%m') AS \`Reporting Month\`,
        os.net_total AS order_revenue,
        CASE 
            WHEN COUNT(DISTINCT opl.product_id) > 3 OR SUM(opl.product_qty) > 15 THEN 'Project Basket'
            ELSE 'Maintenance Basket'
        END AS \`Basket Type\`
    FROM wp_wc_order_stats os
    JOIN wp_wc_order_product_lookup opl ON os.order_id = opl.order_id
    WHERE os.status NOT IN ('wc-pending', 'wc-cancelled', 'wc-refunded', 'wc-failed', 'trash', 'wc-trash')
      AND os.date_created >= DATE_SUB(CURDATE(), INTERVAL 24 MONTH)
    GROUP BY os.order_id, \`Reporting Month\`, os.net_total
) AS order_classifications
-- STEP 2: Group the tagged orders by Month and Type
GROUP BY \`Reporting Month\`, \`Basket Type\`
ORDER BY \`Reporting Month\` DESC;`
        },
        {
            title: "9. Consumable Replenishment Velocity",
            query: `SELECT
    COALESCE(NULLIF(var_p.post_title, ''), parent_p.post_title) AS \`Product Name\`,
    cat.name AS \`Category\`,
    COUNT(DISTINCT repeat_purchases.customer_email) AS \`Total Repeat Buyers\`,
    ROUND(AVG(DATEDIFF(last_purchase, first_purchase) / (purchase_count - 1)), 0) AS \`Average Days to Repurchase\`
FROM (
    SELECT 
        opl.product_id,
        opl.variation_id,
        pm.meta_value AS customer_email,
        COUNT(DISTINCT opl.order_id) AS purchase_count,
        MIN(opl.date_created) AS first_purchase,
        MAX(opl.date_created) AS last_purchase
    FROM wp_wc_order_product_lookup opl
    JOIN wp_wc_order_stats os ON os.order_id = opl.order_id
    JOIN wp_postmeta pm ON pm.post_id = opl.order_id AND pm.meta_key = '_billing_email'
    WHERE os.status NOT IN ('wc-pending', 'wc-cancelled', 'wc-refunded', 'wc-failed', 'trash', 'wc-trash')
      AND os.date_created >= DATE_SUB(CURDATE(), INTERVAL 24 MONTH)
    GROUP BY opl.product_id, opl.variation_id, pm.meta_value
    HAVING COUNT(DISTINCT opl.order_id) > 1
) AS repeat_purchases
JOIN wp_posts parent_p ON parent_p.ID = repeat_purchases.product_id
LEFT JOIN wp_posts var_p ON var_p.ID = repeat_purchases.variation_id AND repeat_purchases.variation_id > 0
JOIN wp_term_relationships tr ON tr.object_id = repeat_purchases.product_id
JOIN wp_term_taxonomy tt ON tt.term_taxonomy_id = tr.term_taxonomy_id AND tt.taxonomy = 'product_cat'
JOIN wp_terms cat ON cat.term_id = tt.term_id
WHERE cat.name IN (
    'Oils, Fuels & Maintenance', 
    'Fuels & Oils', 
    'Lubricants & Cleaners', 
    'Pressure Washer Fluids', 
    'Chainsaw Chains', 
    'Semi Chisel Chains', 
    'Full Chisel Chains', 
    'Milling Chains', 
    'Trimmer Lines, Heads & Blades', 
    'Trimmer Line', 
    'Trimmer Spools', 
    'Spark Plugs', 
    'Service Kits', 
    'Wood Treatments and Preservatives', 
    'Plant Feeds and Lawn Care', 
    'Weed Killers and Tree Stump Killers', 
    'Compost and Bark', 
    'Pest Control', 
    'Screws, Nails & Fixings', 
    'Screws - Nails - Bolts and Staples', 
    'Masonry Fixings', 
    'Glue and Adhesive Tape', 
    'Rock Salt', 
    'Coal and Logs', 
    'Charcoal and BBQ'
) 
GROUP BY \`Product Name\`, \`Category\`
ORDER BY \`Total Repeat Buyers\` DESC;`
        },
        {
            title: "10. Top AOV Multipliers (High-Value Anchors)",
            query: `SELECT 
    DATE_FORMAT(os.date_created, '%Y-%m') AS \`Reporting Month\`,
    COALESCE(NULLIF(var_p.post_title, ''), parent_p.post_title) AS \`Product Name\`,
    COUNT(DISTINCT os.order_id) AS \`Total Orders Containing Item\`,
    SUM(opl.product_net_revenue) AS \`Item Direct Revenue\`,
    SUM(os.net_total) AS \`Total Basket Revenue\`,
    SUM(os.net_total) / COUNT(DISTINCT os.order_id) AS \`Average Basket Value\`
FROM wp_wc_order_product_lookup opl
JOIN wp_wc_order_stats os ON os.order_id = opl.order_id
LEFT JOIN wp_posts parent_p ON parent_p.ID = opl.product_id
LEFT JOIN wp_posts var_p ON var_p.ID = opl.variation_id AND opl.variation_id > 0
WHERE os.status NOT IN ('wc-pending', 'wc-cancelled', 'wc-refunded', 'wc-failed', 'trash', 'wc-trash')
  AND os.date_created >= DATE_SUB(CURDATE(), INTERVAL 24 MONTH)
GROUP BY \`Reporting Month\`, opl.product_id, opl.variation_id
HAVING \`Total Orders Containing Item\` > 1 
ORDER BY \`Reporting Month\` DESC, \`Average Basket Value\` DESC;`
        },
        {
            title: "11. Cross-Category Penetration Rate",
            query: `SELECT 
    \`Reporting Month\`,
    CASE 
        WHEN \`Distinct Categories\` > 1 THEN 'Multi-Category Basket'
        ELSE 'Single-Category Basket'
    END AS \`Cross-Category Status\`,
    COUNT(order_id) AS \`Total Baskets\`
FROM (
    SELECT 
        os.order_id,
        DATE_FORMAT(os.date_created, '%Y-%m') AS \`Reporting Month\`,
        COUNT(DISTINCT cat.term_id) AS \`Distinct Categories\`
    FROM wp_wc_order_stats os
    JOIN wp_wc_order_product_lookup opl ON os.order_id = opl.order_id
    JOIN wp_term_relationships tr ON tr.object_id = opl.product_id
    JOIN wp_term_taxonomy tt ON tt.term_taxonomy_id = tr.term_taxonomy_id AND tt.taxonomy = 'product_cat'
    JOIN wp_terms cat ON cat.term_id = tt.term_id
    WHERE os.status NOT IN ('wc-pending', 'wc-cancelled', 'wc-refunded', 'wc-failed', 'trash', 'wc-trash')
      AND os.date_created >= DATE_SUB(CURDATE(), INTERVAL 24 MONTH)
      AND tt.parent = 0 -- This ensures it only counts Top-Level Categories
    GROUP BY os.order_id, \`Reporting Month\`
) AS order_cats
GROUP BY \`Reporting Month\`, \`Cross-Category Status\`
ORDER BY \`Reporting Month\` DESC;`
        }
    ];
}

// ===== LOGIC SECTION (after SQL queries) =====

// Initialize the Application
document.addEventListener('DOMContentLoaded', async function() {
    console.log("App Initialized v1.5.0");
    initTabs();
    initFileUpload();
    initSqlRepository();
    initGeminiIntegration();
    
    const now = new Date();
    const fmt = (d) => d.getFullYear() + '-' + (d.getMonth()+1).toString().padStart(2,'0');
    const sixAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    
    const fromEl = document.getElementById('globalDateFrom');
    const toEl = document.getElementById('globalDateTo');
    if (fromEl && toEl) {
        fromEl.value = fmt(sixAgo);
        toEl.value = fmt(now);
        dateRangeFrom = fromEl.value;
        dateRangeTo = toEl.value;
        fromEl.addEventListener('change', () => { dateRangeFrom = fromEl.value; updateDashboards(); });
        toEl.addEventListener('change', () => { dateRangeTo = toEl.value; updateDashboards(); });
    }

    const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const defA = fmt(now);
    const defB = fmt(prevMonth);
    
    // Customer tab pickers
    const custA = document.getElementById('customerMonthA');
    const custB = document.getElementById('customerMonthB');
    if (custA && custB) {
        custA.value = defA; custB.value = defB;
        customerMonthA = defA; customerMonthB = defB;
        custA.addEventListener('change', () => { customerMonthA = custA.value; updateDashboards(); });
        custB.addEventListener('change', () => { customerMonthB = custB.value; updateDashboards(); });
    }
    // Shipping tab pickers
    const shipA = document.getElementById('shippingMonthA');
    const shipB = document.getElementById('shippingMonthB');
    if (shipA && shipB) {
        shipA.value = defA; shipB.value = defB;
        shippingMonthA = defA; shippingMonthB = defB;
        shipA.addEventListener('change', () => { shippingMonthA = shipA.value; updateDashboards(); });
        shipB.addEventListener('change', () => { shippingMonthB = shipB.value; updateDashboards(); });
    }
    // Payment tab pickers
    const payA = document.getElementById('paymentMonthA');
    const payB = document.getElementById('paymentMonthB');
    if (payA && payB) {
        payA.value = defA; payB.value = defB;
        paymentMonthA = defA; paymentMonthB = defB;
        payA.addEventListener('change', () => { paymentMonthA = payA.value; updateDashboards(); });
        payB.addEventListener('change', () => { paymentMonthB = payB.value; updateDashboards(); });
    }
    // Product table pickers
    const prodA = document.getElementById('productTableMonthA');
    const prodB = document.getElementById('productTableMonthB');
    if (prodA && prodB) {
        prodA.value = defA; prodB.value = defB;
        productTableMonthA = defA; productTableMonthB = defB;
        prodA.addEventListener('change', () => { productTableMonthA = prodA.value; updateDashboards(); });
        prodB.addEventListener('change', () => { productTableMonthB = prodB.value; updateDashboards(); });
    }
    // Category table pickers
    const catA = document.getElementById('categoryTableMonthA');
    const catB = document.getElementById('categoryTableMonthB');
    if (catA && catB) {
        catA.value = defA; catB.value = defB;
        categoryTableMonthA = defA; categoryTableMonthB = defB;
        catA.addEventListener('change', () => { categoryTableMonthA = catA.value; updateDashboards(); });
        catB.addEventListener('change', () => { categoryTableMonthB = catB.value; updateDashboards(); });
    }

    const savedData = await loadAppDataFromDB();
    if (savedData && (savedData.executive || savedData.customer || savedData.shipping || savedData.product || savedData.payment)) {
        appData = savedData;
        updateDashboards();
    }
});

function initTabs() {
    var tabBtns = document.querySelectorAll('.tab-btn');
    var tabContents = document.querySelectorAll('.tab-content');
    tabBtns.forEach(function(btn) {
        btn.addEventListener('click', function() {
            tabBtns.forEach(function(b) { b.classList.remove('active'); });
            tabContents.forEach(function(c) { c.classList.remove('active'); });
            btn.classList.add('active');
            var targetEl = document.getElementById(btn.getAttribute('data-target'));
            if (targetEl) {
                targetEl.classList.add('active');
                if (btn.getAttribute('data-target') === 'tab-data') updateDataStatusTab();
            }
        });
    });
}

function normalizeCsvHeader(header) {
    return String(header || '')
        .replace(/^\uFEFF/, '')
        .replace(/\u00C2/g, '')
        .replace(/\u00A0/g, ' ')
        .trim()
        .replace(/\s+/g, ' ');
}

function canonicalCsvHeader(header) {
    const cleaned = normalizeCsvHeader(header);
    const lookupKey = cleaned.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const aliases = {
        'reporting month': 'Reporting Month',
        'sku': 'SKU',
        'product title': 'Product title',
        'n revenue': 'N. Revenue',
        'net revenue': 'N. Revenue',
        'units': 'Units',
        'category': 'Category',
        'payment gateway': 'Payment Gateway',
        'revenue': 'Revenue',
        'orders': 'Orders',
        'shipping method name': 'shipping_method_name',
        'customer type': 'customer_type',
        'average order value': 'average_order_value',
        'total orders': 'total_orders',
        'total revenue': 'total_revenue',
        'total order revenue': 'total_order_revenue',
        'total shipping revenue': 'total_shipping_revenue',
        'product a': 'Product A',
        'product b': 'Product B',
        'times bought together': 'Times Bought Together',
        'bought together': 'Times Bought Together',
        'pair count': 'Times Bought Together',
        'count distinct opl1 order id': 'Times Bought Together',
        'count': 'Times Bought Together',
        'category id': 'Category ID',
        'category name': 'Category Name',
        'slug': 'Slug',
        'parent id': 'Parent ID',
        'parent name': 'Parent Name'
    };
    return aliases[lookupKey] || cleaned;
}

function normalizeCsvRow(row) {
    const normalized = {};
    Object.keys(row || {}).forEach(function(key) {
        normalized[canonicalCsvHeader(key)] = row[key];
    });
    return normalized;
}

function csvHasFields(fields, requiredFields) {
    return requiredFields.every(function(field) {
        return fields.includes(field);
    });
}

function parseCsvNumber(value) {
    if (typeof value === 'number') return value;
    const cleaned = String(value || '').replace(/,/g, '').trim();
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeBasketRows(rows) {
    return rows.map(function(row) {
        return {
            'Product A': String(row['Product A'] || '').trim(),
            'Product B': String(row['Product B'] || '').trim(),
            'Times Bought Together': parseCsvNumber(row['Times Bought Together'])
        };
    }).filter(function(row) {
        return row['Product A'] && row['Product B'] && row['Times Bought Together'] > 0;
    }).sort(function(a, b) {
        return b['Times Bought Together'] - a['Times Bought Together'];
    });
}

function normalizeCategoryHierarchyRows(rows) {
    return rows.map(function(row) {
        return {
            'Category ID': parseCsvNumber(row['Category ID']),
            'Category Name': String(row['Category Name'] || '').trim(),
            'Slug': String(row['Slug'] || '').trim(),
            'Parent ID': parseCsvNumber(row['Parent ID']),
            'Parent Name': String(row['Parent Name'] || '').trim()
        };
    }).filter(function(row) {
        return row['Category ID'] && row['Category Name'];
    });
}

function initFileUpload() {
    var fileInput = document.getElementById('csvFileInput');
    var statusText = document.getElementById('uploadStatus');
    if (!fileInput) return;
    fileInput.addEventListener('change', function(e) {
        var files = e.target.files;
        if (files.length > 0) {
            statusText.textContent = 'Processing ' + files.length + ' file(s)...';
            statusText.style.color = '#373737';
            let filesProcessed = 0;
            let datasetsFound = [];
            let unrecognizedFiles = [];
            for (let i = 0; i < files.length; i++) {
                Papa.parse(files[i], {
                    header: true, dynamicTyping: true, skipEmptyLines: true,
                    transformHeader: canonicalCsvHeader,
                    transform: function(value) {
                        if (typeof value === 'string') return value.replace(/\u00C2/g, '').trim();
                        return value;
                    },
                    complete: function(results) {
                        const fields = (results.meta.fields || []).map(canonicalCsvHeader).filter(Boolean);
                        const data = (results.data || []).map(normalizeCsvRow);
                        const timestamp = new Date().toLocaleString();
                        
                        const recordLoad = (key, name) => {
                            appData[key] = data;
                            datasetsFound.push(name);
                            if (!appData.uploadMeta) appData.uploadMeta = {};
                            appData.uploadMeta[key] = timestamp;
                        };

                        if (fields.includes('SKU') || fields.includes('Product title')) {
                            recordLoad('product', 'Product');
                        } else if (csvHasFields(fields, ['Category ID', 'Category Name', 'Parent ID', 'Parent Name'])) {
                            appData.categoryHierarchy = normalizeCategoryHierarchyRows(data);
                            datasetsFound.push('Category Hierarchy');
                            if (!appData.uploadMeta) appData.uploadMeta = {};
                            appData.uploadMeta['categoryHierarchy'] = timestamp;
                        } else if (csvHasFields(fields, ['Product A', 'Product B', 'Times Bought Together'])) {
                            appData.basket = normalizeBasketRows(data);
                            datasetsFound.push('Basket Pairs');
                            if (!appData.uploadMeta) appData.uploadMeta = {};
                            appData.uploadMeta['basket'] = timestamp;
                        } else if (fields.includes('Basket Type') && fields.includes('Total Baskets')) {
                            recordLoad('basketProject', 'Project Baskets');
                        } else if (fields.includes('Average Days to Repurchase')) {
                            recordLoad('basketConsumables', 'Consumables');
                        } else if (fields.includes('Total Orders Containing Item') && fields.includes('Average Basket Value')) {
                            recordLoad('basketAnchors', 'AOV Anchors');
                        } else if (fields.includes('Cross-Category Status')) {
                            recordLoad('basketCrossCategory', 'Cross Category');
                        } else if (fields.includes('Payment Gateway')) {
                            recordLoad('payment', 'Payment');
                        } else if (fields.includes('shipping_method_name')) {
                            recordLoad('shipping', 'Shipping');
                        } else if (fields.includes('customer_type')) {
                            recordLoad('customer', 'Customer');
                        } else if (fields.includes('Reporting Month') && fields.includes('average_order_value')) {
                            recordLoad('executive', 'Executive');
                        } else {
                            unrecognizedFiles.push(files[i].name + ': ' + fields.join(', '));
                        }
                        filesProcessed++;
                        if (filesProcessed === files.length) {
                            if (datasetsFound.length > 0) {
                                statusText.textContent = 'Loaded ' + datasetsFound.length + ' dataset(s): ' + datasetsFound.join(', ');
                                statusText.style.color = '#009640';
                            } else {
                                statusText.textContent = 'Loaded 0 datasets. Unrecognized CSV headers: ' + unrecognizedFiles.join(' | ');
                                statusText.style.color = '#EF4444';
                            }
                            updateDashboards();
                        }
                    }
                });
            }
        }
    });
}

// ===== UTILITIES =====
function getMonthsInRange() {
    if (!dateRangeFrom || !dateRangeTo) return [];
    let months = [];
    let [fy, fm] = dateRangeFrom.split('-').map(Number);
    let [ty, tm] = dateRangeTo.split('-').map(Number);
    let d = new Date(fy, fm - 1, 1);
    let end = new Date(ty, tm - 1, 1);
    while (d <= end) {
        months.push(d.getFullYear() + '-' + (d.getMonth()+1).toString().padStart(2,'0'));
        d.setMonth(d.getMonth() + 1);
    }
    return months;
}

function formatMonthLabel(ym) {
    const names = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    let [y, m] = ym.split('-').map(Number);
    return names[m-1] + ' ' + y.toString().substring(2);
}

function getPrevMonth(ym) {
    let [y, m] = ym.split('-').map(Number);
    let d = new Date(y, m - 2, 1);
    return d.getFullYear() + '-' + (d.getMonth()+1).toString().padStart(2,'0');
}

function getYoyMonth(ym) {
    let [y, m] = ym.split('-').map(Number);
    return (y-1) + '-' + m.toString().padStart(2,'0');
}

function getCategoryNames(row) {
    if (!row || !row.Category) return [];
    const categorySet = new Set();
    row.Category.split(',').map(c => c.trim()).filter(Boolean).forEach(function(categoryName) {
        addCategoryWithParents(categorySet, categoryName);
    });
    return Array.from(categorySet);
}

function getCategoryHierarchyLookup() {
    const rows = appData.categoryHierarchy || [];
    if (categoryHierarchyLookupCache.source === rows && categoryHierarchyLookupCache.byName) {
        return categoryHierarchyLookupCache.byName;
    }
    const byName = {};
    rows.forEach(function(row) {
        if (row['Category Name']) byName[row['Category Name']] = row;
    });
    categoryHierarchyLookupCache = { source: rows, byName: byName };
    return byName;
}

function addCategoryWithParents(categorySet, categoryName) {
    const byName = getCategoryHierarchyLookup();
    let currentName = categoryName;
    let guard = 0;
    while (currentName && guard < 20) {
        categorySet.add(currentName);
        const current = byName[currentName];
        const parentName = current ? current['Parent Name'] : '';
        if (!parentName || parentName === currentName) break;
        currentName = parentName;
        guard++;
    }
}

function formatCurrency(amount) {
    return '\u00A3' + amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatWholeNumber(value) {
    return Math.round(value).toLocaleString();
}

function setElementText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

function getPrimaryCategoryName(row) {
    if (!row || !row.Category) return '';
    return row.Category.split(',').map(c => c.trim())[0] || '';
}

function calculateTrendSummary(rows, months) {
    const monthCount = months.length || 1;
    const totals = rows.reduce((acc, row) => {
        acc.revenue += (row['N. Revenue'] || 0);
        acc.units += (row['Units'] || 0);
        return acc;
    }, { revenue: 0, units: 0 });
    return {
        totalRevenue: totals.revenue,
        averageRevenue: totals.revenue / monthCount,
        totalUnits: totals.units,
        averageUnits: totals.units / monthCount
    };
}

function updateTrendSummary(prefix, summary) {
    setElementText(prefix + 'TotalRevenue', formatCurrency(summary.totalRevenue));
    setElementText(prefix + 'AvgRevenue', formatCurrency(summary.averageRevenue));
    setElementText(prefix + 'TotalUnits', formatWholeNumber(summary.totalUnits));
    setElementText(prefix + 'AvgUnits', formatWholeNumber(summary.averageUnits));
}

function updateDashboards() {
    if (appData.executive) updateExecutiveDashboard();
    if (appData.customer) updateCustomerDashboard();
    if (appData.shipping) updateShippingDashboard();
    if (appData.product) {
        updateProductDashboard();
        updateCategoryDashboard();
        updateCategoryBrowser();
    }
    if (appData.basket) updateBasketDashboard();
    if (appData.payment) updatePaymentDashboard();
    updateDataStatusTab();
    saveAppDataToDB();
}

function updateDataStatusTab() {
    const tbody = document.querySelector('#dataStatusTable tbody');
    if (!tbody) return;

    const datasets = [
        { key: 'executive', name: 'Executive Summary' },
        { key: 'customer', name: 'Customer Split' },
        { key: 'shipping', name: 'Shipping & Delivery' },
        { key: 'product', name: 'Product/Category Performance' },
        { key: 'categoryHierarchy', name: 'Category Hierarchy' },
        { key: 'payment', name: 'Payment Methods' },
        { key: 'basket', name: 'Basket Pairs' },
        { key: 'basketProject', name: 'Project Baskets' },
        { key: 'basketConsumables', name: 'Consumables' },
        { key: 'basketAnchors', name: 'AOV Anchors' },
        { key: 'basketCrossCategory', name: 'Cross Category' }
    ];

    tbody.innerHTML = '';
    datasets.forEach(ds => {
        const isLoaded = !!(appData[ds.key] && (Array.isArray(appData[ds.key]) ? appData[ds.key].length > 0 : true));
        const timestamp = appData.uploadMeta ? appData.uploadMeta[ds.key] : null;

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="font-weight: 600;">${ds.name}</td>
            <td>
                <span class="status-badge ${isLoaded ? 'status-loaded' : 'status-empty'}">
                    ${isLoaded ? 'Loaded' : 'Empty'}
                </span>
            </td>
            <td style="color: #64748B; font-size: 0.85rem;">${timestamp || '--'}</td>
            <td style="text-align: right;">
                ${isLoaded ? `<button class="btn-secondary" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; border-color: #EF4444; color: #EF4444;" onclick="deleteDataset('${ds.key}')">Delete</button>` : '--'}
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function deleteDataset(key) {
    if (!confirm('Are you sure you want to delete this dataset? All associated dashboard views will be cleared.')) return;
    
    appData[key] = null;
    if (appData.uploadMeta) delete appData.uploadMeta[key];
    
    // Special cleanup for hierarchy cache
    if (key === 'categoryHierarchy') {
        categoryHierarchyLookupCache = { source: null, byName: null };
    }

    // Refresh everything
    updateDashboards();
    
    // Clear status text
    const statusText = document.getElementById('uploadStatus');
    if (statusText) statusText.textContent = 'Dataset deleted.';
}

// ===== FULL REPORT EXPORT =====
async function exportFullReport() {
    const exportBtn = document.querySelector('button[onclick="exportFullReport()"]');
    const originalBtnText = exportBtn ? exportBtn.innerHTML : '📋 Export Report';
    if (exportBtn) {
        exportBtn.innerHTML = '⏳ Exporting...';
        exportBtn.disabled = true;
    }

    // Tab definitions with charts and tables
    const tabs = [
        {
            id: 'tab-executive', name: 'Executive Summary',
            kpis: [
                { label: 'Total Revenue', id: 'kpi-revenue', trendId: 'kpi-revenue-trend', desc: 'Total net revenue for the most recent month in the selected date range.' },
                { label: 'Total Orders', id: 'kpi-orders', trendId: 'kpi-orders-trend', desc: 'Total number of completed orders in the most recent month.' },
                { label: 'AOV', id: 'kpi-aov', trendId: 'kpi-aov-trend', desc: 'Average Order Value — total revenue divided by total orders for the latest month.' }
            ],
            charts: [
                { id: 'executiveTrendChart', title: 'Revenue & Orders Trend', desc: 'Dual-axis line chart tracking total revenue (left axis, £) and total orders (right axis) over the selected date range.' }
            ],
            tables: []
        },
        {
            id: 'tab-customer', name: 'Customer Split',
            kpis: [],
            charts: [
                { id: 'repeatNewOrdersChart', title: 'New vs Repeat Orders', desc: 'Donut chart showing the proportion of orders from first-time customers versus returning customers for the selected month.' },
                { id: 'customerRevenueChart', title: 'Revenue by Customer Type', desc: 'Stacked bar comparing total revenue generated by new vs repeat customers across both selected comparison months.' },
                { id: 'customerTrendChart', title: 'Customer Trend Over Time', desc: 'Line chart tracking revenue from new and repeat customers separately across the full date range to identify retention trends.' },
                { id: 'customerAovChart', title: 'AOV Comparison', desc: 'Bar chart comparing the Average Order Value of new vs repeat customers for both selected comparison months.' }
            ],
            tables: []
        },
        {
            id: 'tab-shipping', name: 'Shipping & Delivery',
            kpis: [],
            charts: [
                { id: 'shippingTrendChart', title: 'Shipping Volume Trend', desc: 'Multi-line chart showing monthly order volumes split by each shipping/fulfillment method over the date range.' },
                { id: 'fulfillmentVolumeChart', title: 'Fulfillment Methods (Volume)', desc: 'Donut chart showing the share of total orders handled by each fulfillment method for the selected comparison month.' },
                { id: 'fulfillmentRevenueChart', title: 'Shipping Revenue Collected', desc: 'Donut chart showing how much shipping revenue each fulfillment method generated for the selected month.' },
                { id: 'orderRevenueByMethodChart', title: 'Total Order Revenue by Method', desc: 'Stacked bar chart comparing total order revenue (not just shipping fees) attributed to each delivery method across both comparison months.' }
            ],
            tables: []
        },
        {
            id: 'tab-product', name: 'Product Performance',
            kpis: [],
            summaryCards: [
                { label: 'Total Revenue', id: 'productTrendTotalRevenue' },
                { label: 'Avg Monthly Revenue', id: 'productTrendAvgRevenue' },
                { label: 'Total Units Sold', id: 'productTrendTotalUnits' },
                { label: 'Avg Units Per Month', id: 'productTrendAvgUnits' }
            ],
            charts: [
                { id: 'productTrendChart', title: 'Product Sales Trend', desc: 'Line chart showing revenue and units sold for the selected product (or all products) over the date range.' }
            ],
            tables: [
                { id: 'productTableA', title: 'Top Performers (Month A)', desc: 'Ranked table of products by revenue for the first selected month, with MoM and YoY comparisons.' },
                { id: 'productTableB', title: 'Top Performers (Month B)', desc: 'Ranked table of products by revenue for the second selected month, with MoM and YoY comparisons.' },
                { id: 'productRisingStars', title: 'Rising Stars (Biggest £ Gains)', desc: 'Products with the largest absolute revenue increase between the previous month and the current month.' },
                { id: 'productFallingStars', title: 'Falling Stars (Biggest £ Drops)', desc: 'Products with the largest absolute revenue decrease between the previous month and the current month.' }
            ]
        },
        {
            id: 'tab-category', name: 'Category Performance',
            kpis: [],
            summaryCards: [
                { label: 'Total Revenue', id: 'categoryTrendTotalRevenue' },
                { label: 'Avg Monthly Revenue', id: 'categoryTrendAvgRevenue' },
                { label: 'Total Units Sold', id: 'categoryTrendTotalUnits' },
                { label: 'Avg Units Per Month', id: 'categoryTrendAvgUnits' }
            ],
            charts: [
                { id: 'categoryTrendChart', title: 'Category Sales Trend', desc: 'Line chart showing revenue and units sold for the selected category (or all categories) over the date range. Products are attributed via the hierarchy CSV.' }
            ],
            tables: [
                { id: 'categoryTableA', title: 'Top Categories (Month A)', desc: 'Ranked table of categories by revenue for the first selected month, with MoM and YoY comparisons.' },
                { id: 'categoryTableB', title: 'Top Categories (Month B)', desc: 'Ranked table of categories by revenue for the second selected month, with MoM and YoY comparisons.' },
                { id: 'categoryRisingStars', title: 'Rising Stars (Biggest £ Gains)', desc: 'Categories with the largest absolute revenue increase between the previous month and the current month.' },
                { id: 'categoryFallingStars', title: 'Falling Stars (Biggest £ Drops)', desc: 'Categories with the largest absolute revenue decrease between the previous month and the current month.' }
            ]
        },
        {
            id: 'tab-basket', name: 'Basket Analysis',
            kpis: [],
            inlineMetrics: [
                { label: 'Project AOV', id: 'projectAovMetric', desc: 'Average order value for baskets classified as projects (>3 unique items or >15 total units).' },
                { label: 'Maintenance AOV', id: 'maintenanceAovMetric', desc: 'Average order value for baskets classified as maintenance (≤3 unique items and ≤15 units).' }
            ],
            charts: [
                { id: 'basketTopPairsChart', title: 'Top 10 Most Paired Products', desc: 'Horizontal bar chart showing the 10 product pairs most frequently purchased together in the same order.' },
                { id: 'basketDistChart', title: 'Pair Frequency Distribution', desc: 'Distribution chart showing how many product pairs occur at each frequency level — helps identify whether cross-selling is concentrated or broad.' },
                { id: 'basketProjectSplitChart', title: 'Project vs. Maintenance Baskets', desc: 'Categorizes baskets based on item quantity/variety to show if orders are typically large projects or single-item maintenance purchases.' },
                { id: 'crossCategoryGauge', title: 'Cross-Category Penetration Rate', desc: 'Shows the percentage of orders containing items from more than one distinct top-level category.' },
                { id: 'aovMultipliersChart', title: 'Top AOV Multipliers', desc: 'Highlights individual products that, when included in a basket, result in the highest total Average Order Value.' }
            ],
            tables: [
                { id: 'consumableVelocityTable', title: 'Consumable Reorder Rates', desc: 'Tracks specific consumable items to show how many days it typically takes for customers to purchase them again.' },
                { id: 'basketTable', title: 'Product Pairings', desc: 'Full table of every product pair and how many times they were bought together.' }
            ]
        },
        {
            id: 'tab-payment', name: 'Payment Methods',
            kpis: [],
            charts: [
                { id: 'paymentTrendChart', title: 'Payment Revenue Trend', desc: 'Multi-line chart tracking total revenue processed through each payment gateway over the date range.' },
                { id: 'paymentPieChart', title: 'Revenue Split (Month A)', desc: 'Pie chart showing the percentage of total revenue handled by each payment gateway for the selected month.' },
                { id: 'paymentPieChartB', title: 'Revenue Split (Month B)', desc: 'Pie chart for the second comparison month — compare side-by-side with the first to spot payment method shifts.' }
            ],
            tables: [
                { id: 'paymentHistoryTable', title: 'Gateway Comparison', desc: 'Table comparing order counts and revenue totals for each payment gateway across both selected comparison months.' }
            ]
        }
    ];

    // Temporarily show ALL tab sections so canvases have real dimensions
    const allSections = document.querySelectorAll('.tab-content');
    const originalDisplay = [];
    allSections.forEach(section => {
        originalDisplay.push(section.style.display);
        section.style.display = 'block';
        section.classList.add('active');
    });

    // Force a reflow so containers get real dimensions
    document.body.offsetHeight;

    // Re-render ALL dashboards while tabs are visible.
    // This is critical — Chart.js skips rendering on hidden canvases,
    // so charts on unvisited tabs were never drawn at all.
    if (appData.executive) updateExecutiveDashboard();
    if (appData.customer) updateCustomerDashboard();
    if (appData.shipping) updateShippingDashboard();
    if (appData.product) {
        updateProductDashboard();
        updateCategoryDashboard();
    }
    if (appData.basket) updateBasketDashboard();
    if (appData.payment) updatePaymentDashboard();

    // Wait for Chart.js animation frames to complete painting
    await new Promise(r => setTimeout(r, 1500));

    // Helper: capture a chart canvas as a data URL
    function captureChart(canvasId) {
        const canvas = document.getElementById(canvasId);
        if (!canvas || !canvas.getContext) return null;
        if (canvas.width === 0 || canvas.height === 0) return null;
        try {
            return canvas.toDataURL('image/png');
        } catch (e) {
            return null;
        }
    }

    // Helper: extract a table as an HTML string
    function captureTable(tableId) {
        const table = document.getElementById(tableId);
        if (!table) return null;
        const clone = table.cloneNode(true);
        // Strip sort arrows from headers for cleanliness
        clone.querySelectorAll('th').forEach(th => {
            th.removeAttribute('data-sort');
            th.removeAttribute('style');
        });
        return clone.outerHTML;
    }

    // Build the report
    const dateFrom = document.getElementById('globalDateFrom')?.value || '';
    const dateTo = document.getElementById('globalDateTo')?.value || '';
    const now = new Date().toLocaleString();

    let html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Briants Monthly Report - Export ${now}</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Inter', 'Helvetica Neue', Arial, sans-serif; color: #373737; background: #fff; padding: 2rem; max-width: 1200px; margin: 0 auto; line-height: 1.5; }
h1 { font-size: 2rem; color: #009640; margin-bottom: 0.5rem; }
.meta { color: #64748B; font-size: 0.9rem; margin-bottom: 2rem; border-bottom: 2px solid #E2E8F0; padding-bottom: 1rem; }
.tab-section { margin-bottom: 3rem; page-break-inside: avoid; }
.tab-title { font-size: 1.5rem; color: #fff; background: #009640; padding: 0.75rem 1.25rem; border-radius: 6px; margin-bottom: 1.5rem; }
.kpi-row { display: flex; gap: 1.5rem; margin-bottom: 1.5rem; flex-wrap: wrap; }
.kpi-box { flex: 1; min-width: 180px; background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 1rem; text-align: center; border-top: 3px solid #009640; }
.kpi-label { font-size: 0.8rem; color: #64748B; text-transform: uppercase; font-weight: 600; }
.kpi-val { font-size: 1.5rem; font-weight: 700; margin: 0.25rem 0; }
.kpi-trend { font-size: 0.85rem; }
.chart-block { margin-bottom: 1.5rem; }
.chart-block h4 { margin-bottom: 0.5rem; color: #475569; }
.chart-block img { max-width: 100%; border: 1px solid #E2E8F0; border-radius: 6px; }
table { width: 100%; border-collapse: collapse; margin-bottom: 1.5rem; }
th, td { padding: 0.6rem 0.8rem; text-align: left; border-bottom: 1px solid #E2E8F0; font-size: 0.85rem; }
th { background: #F8FAFC; font-weight: 600; color: #475569; }
tr:nth-child(even) td { background: #FAFBFC; }
.table-title { font-size: 1rem; font-weight: 600; margin-bottom: 0.5rem; color: #373737; }
.summary-row { display: flex; gap: 1rem; margin-bottom: 1rem; flex-wrap: wrap; }
.summary-card { flex: 1; min-width: 140px; background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 6px; padding: 0.75rem; }
.summary-card .label { font-size: 0.72rem; font-weight: 600; color: #64748B; text-transform: uppercase; }
.summary-card .value { font-size: 1.1rem; font-weight: 700; }
.no-data { color: #94A3B8; font-style: italic; margin-bottom: 1rem; }
.desc { font-size: 0.8rem; color: #64748B; font-style: italic; margin: 0.25rem 0 0.75rem 0; line-height: 1.4; }
</style>
</head>
<body>
<h1>Briants Monthly Report Dashboard</h1>
<div class="meta">
    <strong>Date Range:</strong> ${dateFrom || 'N/A'} to ${dateTo || 'N/A'} &nbsp;|&nbsp; 
    <strong>Exported:</strong> ${now}
</div>
`;

    tabs.forEach(tab => {
        html += `<div class="tab-section">
<h2 class="tab-title">${tab.name}</h2>\n`;

        // KPIs
        if (tab.kpis && tab.kpis.length > 0) {
            html += `<div class="kpi-row">\n`;
            tab.kpis.forEach(k => {
                const valEl = document.getElementById(k.id);
                const trendEl = k.trendId ? document.getElementById(k.trendId) : null;
                html += `<div class="kpi-box">
    <div class="kpi-label">${k.label}</div>
    <div class="kpi-val">${valEl ? valEl.textContent : '--'}</div>
    ${trendEl ? `<div class="kpi-trend">${trendEl.textContent}</div>` : ''}
    ${k.desc ? `<div class="desc">${k.desc}</div>` : ''}
</div>\n`;
            });
            html += `</div>\n`;
        }

        // Summary cards (product/category trend summaries)
        if (tab.summaryCards && tab.summaryCards.length > 0) {
            html += `<div class="summary-row">\n`;
            tab.summaryCards.forEach(sc => {
                const el = document.getElementById(sc.id);
                html += `<div class="summary-card">
    <div class="label">${sc.label}</div>
    <div class="value">${el ? el.textContent : '--'}</div>
</div>\n`;
            });
            html += `</div>\n`;
        }

        // Inline metrics (basket AOVs)
        if (tab.inlineMetrics && tab.inlineMetrics.length > 0) {
            html += `<div class="kpi-row">\n`;
            tab.inlineMetrics.forEach(m => {
                const el = document.getElementById(m.id);
                html += `<div class="kpi-box">
    <div class="kpi-label">${m.label}</div>
    <div class="kpi-val">${el ? el.textContent : '--'}</div>
    ${m.desc ? `<div class="desc">${m.desc}</div>` : ''}
</div>\n`;
            });
            html += `</div>\n`;
        }

        // Charts
        if (tab.charts) {
            tab.charts.forEach(c => {
                const dataUrl = captureChart(c.id);
                if (dataUrl) {
                    html += `<div class="chart-block">
    <h4>${c.title}</h4>
    ${c.desc ? `<p class="desc">${c.desc}</p>` : ''}
    <img src="${dataUrl}" alt="${c.title}" />
</div>\n`;
                }
            });
        }

        // Tables
        if (tab.tables) {
            tab.tables.forEach(t => {
                const tableHtml = captureTable(t.id);
                if (tableHtml) {
                    const table = document.getElementById(t.id);
                    const rows = table ? table.querySelectorAll('tbody tr') : [];
                    if (rows.length > 0) {
                        html += `<div class="table-title">${t.title}</div>\n`;
                        if (t.desc) html += `<p class="desc">${t.desc}</p>\n`;
                        html += tableHtml + '\n';
                    }
                }
            });
        }

        html += `</div>\n`;
    });

    html += `</body></html>`;

    // Download
    const blob = new Blob([html], { type: 'text/html; charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Briants_Report_${dateFrom}_to_${dateTo}_${new Date().toISOString().split('T')[0]}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    // Restore original tab visibility
    allSections.forEach((section, i) => {
        section.style.display = originalDisplay[i];
        section.classList.remove('active');
    });
    // Re-activate whichever tab was originally active
    const activeBtn = document.querySelector('.tab-btn.active');
    if (activeBtn) {
        const targetId = activeBtn.getAttribute('data-target');
        const targetEl = document.getElementById(targetId);
        if (targetEl) targetEl.classList.add('active');
    }

    if (exportBtn) {
        exportBtn.innerHTML = originalBtnText;
        exportBtn.disabled = false;
    }
}

function updateTrendElement(id, value, suffix) {
    const el = document.getElementById(id);
    if (!el) return;
    if (value > 0) {
        el.textContent = '+' + value.toFixed(1) + '% ' + suffix;
        el.className = 'kpi-trend trend-up';
    } else if (value < 0) {
        el.textContent = value.toFixed(1) + '% ' + suffix;
        el.className = 'kpi-trend trend-down';
    } else {
        el.textContent = '0% ' + suffix;
        el.className = 'kpi-trend';
    }
}

function updateExecutiveDashboard() {
    const data = appData.executive;
    if (!data || data.length === 0) return;
    const months = getMonthsInRange();
    const latest = months[months.length - 1];
    const prev = months.length > 1 ? months[months.length - 2] : null;
    
    let currRow = data.find(d => d['Reporting Month'] === latest);
    let prevRow = prev ? data.find(d => d['Reporting Month'] === prev) : null;
    
    if (currRow) {
        document.getElementById('kpi-revenue').textContent = '\u00A3' + (currRow.total_revenue || 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
        document.getElementById('kpi-orders').textContent = (currRow.total_orders || 0).toLocaleString();
        document.getElementById('kpi-aov').textContent = '\u00A3' + (currRow.average_order_value || 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
        if (prevRow) {
            updateTrendElement('kpi-revenue-trend', ((currRow.total_revenue - prevRow.total_revenue) / prevRow.total_revenue) * 100, 'MoM');
            updateTrendElement('kpi-orders-trend', ((currRow.total_orders - prevRow.total_orders) / prevRow.total_orders) * 100, 'MoM');
            updateTrendElement('kpi-aov-trend', ((currRow.average_order_value - prevRow.average_order_value) / prevRow.average_order_value) * 100, 'MoM');
        }
    }
    
    // Executive trend chart over range
    let revData = months.map(m => { let r = data.find(d => d['Reporting Month'] === m); return r ? r.total_revenue : 0; });
    let ordData = months.map(m => { let r = data.find(d => d['Reporting Month'] === m); return r ? r.total_orders : 0; });
    renderMultiLineChart('executiveTrendChart', months.map(formatMonthLabel), [
        { label: 'Revenue (\u00A3)', data: revData, color: '#009640', yAxisID: 'y' },
        { label: 'Orders', data: ordData, color: '#FFE600', yAxisID: 'y1' }
    ]);
}

function updateCustomerDashboard() {
    const data = appData.customer;
    if (!data || data.length === 0) return;
    const mA = customerMonthA;
    const mB = customerMonthB;
    
    // Donut for month A
    let newA = data.find(d => d['Reporting Month'] === mA && d.customer_type === 'New Customer');
    let repA = data.find(d => d['Reporting Month'] === mA && d.customer_type === 'Repeat Customer');
    renderDonutChart('repeatNewOrdersChart', ['Repeat (' + formatMonthLabel(mA) + ')', 'New'], [repA ? repA.total_orders : 0, newA ? newA.total_orders : 0], ['#009640', '#FFE600']);
    
    // Revenue comparison bar
    let newB = data.find(d => d['Reporting Month'] === mB && d.customer_type === 'New Customer');
    let repB = data.find(d => d['Reporting Month'] === mB && d.customer_type === 'Repeat Customer');
    renderStackedBarChart('customerRevenueChart', [formatMonthLabel(mA), formatMonthLabel(mB)],
        [{label: 'Repeat', data: [repA ? repA.total_revenue : 0, repB ? repB.total_revenue : 0], backgroundColor: '#009640'},
         {label: 'New', data: [newA ? newA.total_revenue : 0, newB ? newB.total_revenue : 0], backgroundColor: '#FFE600'}]);

    // AOV comparison
    renderStackedBarChart('customerAovChart', [formatMonthLabel(mA), formatMonthLabel(mB)],
        [{label: 'Repeat AOV', data: [repA ? repA.average_order_value : 0, repB ? repB.average_order_value : 0], backgroundColor: '#009640'},
         {label: 'New AOV', data: [newA ? newA.average_order_value : 0, newB ? newB.average_order_value : 0], backgroundColor: '#FFE600'}]);

    // Trend line over date range
    const months = getMonthsInRange();
    let newRev = months.map(m => { let r = data.find(d => d['Reporting Month'] === m && d.customer_type === 'New Customer'); return r ? r.total_revenue : 0; });
    let repRev = months.map(m => { let r = data.find(d => d['Reporting Month'] === m && d.customer_type === 'Repeat Customer'); return r ? r.total_revenue : 0; });
    renderMultiLineChart('customerTrendChart', months.map(formatMonthLabel), [
        { label: 'Repeat Revenue', data: repRev, color: '#009640' },
        { label: 'New Revenue', data: newRev, color: '#FFE600' }
    ]);
}

function updateShippingDashboard() {
    const data = appData.shipping;
    if (!data || data.length === 0) return;
    const mA = shippingMonthA;
    
    const curData = data.filter(d => d['Reporting Month'] === mA);
    let labels = curData.map(d => d.shipping_method_name || 'Unknown');
    renderBarChart('fulfillmentVolumeChart', labels, curData.map(d => d.total_orders), 'Orders', '#373737', 'x');
    renderBarChart('fulfillmentRevenueChart', labels, curData.map(d => d.total_shipping_revenue), 'Shipping Rev', '#009640', 'x');
    renderBarChart('orderRevenueByMethodChart', labels, curData.map(d => d.total_order_revenue), 'Order Rev', '#FFE600', 'x');

    // Trend over range
    const months = getMonthsInRange();
    let totalOrders = months.map(m => {
        return data.filter(d => d['Reporting Month'] === m).reduce((s, d) => s + (d.total_orders || 0), 0);
    });
    renderLineChart('shippingTrendChart', months.map(formatMonthLabel), { label: 'Total Orders', data: totalOrders, color: '#373737' });
}

function updateProductDashboard() {
    const data = appData.product;
    if (!data || data.length === 0) return;
    const months = getMonthsInRange();

    // Product trend chart (All Products or single SKU)
    let selector = document.getElementById('productTrendSelector');
    let searchInput = document.getElementById('productSearch');
    const minRevInput = document.getElementById('productMinRev');
    const maxRevInput = document.getElementById('productMaxRev');
    const minUnitsInput = document.getElementById('productMinUnits');
    const maxUnitsInput = document.getElementById('productMaxUnits');
    
    if (selector && searchInput) {
        let productStats = new Map(); // sku -> { name, totalRev, totalUnits }
        data.forEach(d => {
            if (!d.SKU) return;
            if (!months.includes(d['Reporting Month'])) return;
            if (!productStats.has(d.SKU)) {
                productStats.set(d.SKU, { name: d['Product title'], totalRev: 0, totalUnits: 0 });
            }
            let s = productStats.get(d.SKU);
            s.totalRev += (Number(d['N. Revenue']) || 0);
            s.totalUnits += (Number(d['Units']) || 0);
        });
        
        const populateOptions = () => {
            let filter = searchInput.value.toLowerCase();
            let minRev = parseFloat(minRevInput.value) || 0;
            let maxRev = parseFloat(maxRevInput.value) || Infinity;
            let minUnits = parseFloat(minUnitsInput.value) || 0;
            let maxUnits = parseFloat(maxUnitsInput.value) || Infinity;

            let currentSel = selector.value;
            selector.innerHTML = '<option value="__ALL__">All Products (Total Revenue)</option>';
            window.lastFilteredProducts = [];
            
            Array.from(productStats.keys()).sort().forEach(sku => {
                let stats = productStats.get(sku);
                let text = '[' + sku + '] ' + stats.name;
                
                if (filter && !text.toLowerCase().includes(filter)) return;
                if (stats.totalRev < minRev || stats.totalRev > maxRev) return;
                if (stats.totalUnits < minUnits || stats.totalUnits > maxUnits) return;
                
                window.lastFilteredProducts.push({ sku, name: stats.name, totalRev: stats.totalRev, totalUnits: stats.totalUnits });
                
                let opt = document.createElement('option');
                opt.value = sku;
                opt.textContent = text;
                selector.appendChild(opt);
            });
            if (currentSel && (currentSel === '__ALL__' || selector.querySelector(`option[value="${currentSel}"]`))) selector.value = currentSel;
            else selector.value = "__ALL__";
        };

        const attachHandlers = () => {
            searchInput.oninput = () => { populateOptions(); renderProductTrendChart(selector.value, data, months); };
            if (minRevInput) minRevInput.oninput = () => { populateOptions(); renderProductTrendChart(selector.value, data, months); };
            if (maxRevInput) maxRevInput.oninput = () => { populateOptions(); renderProductTrendChart(selector.value, data, months); };
            if (minUnitsInput) minUnitsInput.oninput = () => { populateOptions(); renderProductTrendChart(selector.value, data, months); };
            if (maxUnitsInput) maxUnitsInput.oninput = () => { populateOptions(); renderProductTrendChart(selector.value, data, months); };

            selector.onchange = () => {
                renderProductTrendChart(selector.value, data, months);
            };

            let prevBtn = document.getElementById('productPrevBtn');
            let nextBtn = document.getElementById('productNextBtn');
            if (prevBtn && nextBtn) {
                prevBtn.onclick = () => {
                    if (selector.selectedIndex > 0) {
                        selector.selectedIndex--;
                        selector.dispatchEvent(new Event('change'));
                    }
                };
                nextBtn.onclick = () => {
                    if (selector.selectedIndex < selector.options.length - 1) {
                        selector.selectedIndex++;
                        selector.dispatchEvent(new Event('change'));
                    }
                };
            }
        };

        if (!selector.dataset.initialized) {
            selector.dataset.initialized = "true";
        }
        
        populateOptions();
        attachHandlers();
        
        renderProductTrendChart(selector.value, data, months);
    }

    // Two comparison tables
    renderProductTable('productTableA', 'productFilterA', productTableMonthA, data, productSortA, 'A');
    renderProductTable('productTableB', 'productFilterB', productTableMonthB, data, productSortB, 'B');

    // Rising & Falling Stars
    const latest = months[months.length - 1];
    const prev = months.length > 1 ? months[months.length - 2] : null;
    if (latest && prev) {
        renderRisingFallingStars('product', latest, prev, data, 'productRisingStars', 'productFallingStars');
    }
}

function renderProductTrendChart(sku, data, months) {
    let filteredRows;
    let chartData;
    if (sku === '__ALL__') {
        filteredRows = data.filter(d => months.includes(d['Reporting Month']));
        chartData = months.map(m => data.filter(d => d['Reporting Month'] === m).reduce((s, d) => s + (d['N. Revenue'] || 0), 0));
    } else {
        filteredRows = data.filter(d => months.includes(d['Reporting Month']) && d.SKU === sku);
        chartData = months.map(m => {
            return data
                .filter(d => d['Reporting Month'] === m && d.SKU === sku)
                .reduce((s, d) => s + (d['N. Revenue'] || 0), 0);
        });
    }
    updateTrendSummary('productTrend', calculateTrendSummary(filteredRows, months));
    renderLineChart('productTrendChart', months.map(formatMonthLabel), { label: 'Net Revenue (\u00A3)', data: chartData, color: '#009640' });
}

function renderProductTable(tableId, filterId, targetMonth, data, sortState, side) {
    const tbody = document.querySelector('#' + tableId + ' tbody');
    const filterInput = document.getElementById(filterId);
    if (!tbody) return;
    
    const prev = getPrevMonth(targetMonth);
    const yoy = getYoyMonth(targetMonth);
    const curData = data.filter(d => d['Reporting Month'] === targetMonth);
    const prevData = data.filter(d => d['Reporting Month'] === prev);
    const yoyData = data.filter(d => d['Reporting Month'] === yoy);
    
    let rows = curData.map(r => {
        let pRow = prevData.find(p => p.SKU === r.SKU) || {};
        let yRow = yoyData.find(y => y.SKU === r.SKU) || {};
        let pRev = pRow['N. Revenue'] || 0;
        let yRev = yRow['N. Revenue'] || 0;
        let curRev = r['N. Revenue'] || 0;
        return {
            sku: r.SKU || '', name: r['Product title'] || '',
            units: r['Units'] || 0, revenue: curRev,
            prevMom: pRev > 0 ? ((curRev - pRev) / pRev) * 100 : 0,
            yoy: yRev > 0 ? ((curRev - yRev) / yRev) * 100 : 0
        };
    });
    
    // Filter
    let filterText = filterInput ? filterInput.value.toLowerCase() : '';
    if (filterText) rows = rows.filter(r => r.sku.toLowerCase().includes(filterText) || r.name.toLowerCase().includes(filterText));
    
    // Sort
    rows.sort((a, b) => {
        let va = a[sortState.col], vb = b[sortState.col];
        if (typeof va === 'string') { va = va.toLowerCase(); vb = vb.toLowerCase(); }
        return sortState.dir === 'asc' ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1);
    });
    
    tbody.innerHTML = '';
    rows.slice(0, 50).forEach(r => {
        let tr = document.createElement('tr');
        let pStyle = r.prevMom > 0 ? 'color:#009640' : r.prevMom < 0 ? 'color:#EF4444' : '';
        let yStyle = r.yoy > 0 ? 'color:#009640' : r.yoy < 0 ? 'color:#EF4444' : '';
        tr.innerHTML = '<td>' + r.sku + '</td><td>' + r.name + '</td><td>' + r.units + '</td><td>\u00A3' + r.revenue.toLocaleString() + '</td><td style="' + pStyle + '">' + (r.prevMom > 0 ? '+' : '') + r.prevMom.toFixed(1) + '%</td><td style="' + yStyle + '">' + (r.yoy > 0 ? '+' : '') + r.yoy.toFixed(1) + '%</td>';
        tbody.appendChild(tr);
    });
    
    // Sort click handlers
    document.querySelectorAll('#' + tableId + ' th[data-sort]').forEach(th => {
        th.onclick = () => {
            let col = th.getAttribute('data-sort');
            if (sortState.col === col) sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc';
            else { sortState.col = col; sortState.dir = 'desc'; }
            renderProductTable(tableId, filterId, targetMonth, data, sortState, side);
        };
    });
    
    // Filter handler
    if (filterInput) {
        filterInput.oninput = () => renderProductTable(tableId, filterId, targetMonth, data, sortState, side);
    }
}

function updateCategoryDashboard() {
    const data = appData.product;
    if (!data || data.length === 0) return;
    const months = getMonthsInRange();

    // Category trend chart
    let selector = document.getElementById('categoryTrendSelector');
    let searchInput = document.getElementById('categorySearch');
    const minRevInput = document.getElementById('categoryMinRev');
    const maxRevInput = document.getElementById('categoryMaxRev');
    const minUnitsInput = document.getElementById('categoryMinUnits');
    const maxUnitsInput = document.getElementById('categoryMaxUnits');

    if (selector && searchInput) {
        let categoryStats = new Map(); // catName -> { totalRev, totalUnits }
        data.forEach(d => {
            if (!months.includes(d['Reporting Month'])) return;
            getCategoryNames(d).forEach(cat => {
                if (!categoryStats.has(cat)) {
                    categoryStats.set(cat, { totalRev: 0, totalUnits: 0 });
                }
                let s = categoryStats.get(cat);
                s.totalRev += (Number(d['N. Revenue']) || 0);
                s.totalUnits += (Number(d['Units']) || 0);
            });
        });

        const populateOptions = () => {
            let filter = searchInput.value.toLowerCase();
            let minRev = parseFloat(minRevInput.value) || 0;
            let maxRev = parseFloat(maxRevInput.value) || Infinity;
            let minUnits = parseFloat(minUnitsInput.value) || 0;
            let maxUnits = parseFloat(maxUnitsInput.value) || Infinity;

            let currentSel = selector.value;
            selector.innerHTML = '<option value="__ALL__">All Categories (Total Revenue)</option>';
            window.lastFilteredCategories = [];
            
            Array.from(categoryStats.keys()).sort().forEach(cat => {
                let stats = categoryStats.get(cat);
                if (filter && !cat.toLowerCase().includes(filter)) return;
                if (stats.totalRev < minRev || stats.totalRev > maxRev) return;
                if (stats.totalUnits < minUnits || stats.totalUnits > maxUnits) return;

                window.lastFilteredCategories.push({ name: cat, totalRev: stats.totalRev, totalUnits: stats.totalUnits });

                let opt = document.createElement('option');
                opt.value = cat;
                opt.textContent = cat;
                selector.appendChild(opt);
            });
            if (currentSel && (currentSel === '__ALL__' || selector.querySelector(`option[value="${currentSel}"]`))) selector.value = currentSel;
            else selector.value = "__ALL__";
        };

        const attachHandlers = () => {
            searchInput.oninput = () => { populateOptions(); renderCategoryTrendChart(selector.value, data, months); };
            if (minRevInput) minRevInput.oninput = () => { populateOptions(); renderCategoryTrendChart(selector.value, data, months); };
            if (maxRevInput) maxRevInput.oninput = () => { populateOptions(); renderCategoryTrendChart(selector.value, data, months); };
            if (minUnitsInput) minUnitsInput.oninput = () => { populateOptions(); renderCategoryTrendChart(selector.value, data, months); };
            if (maxUnitsInput) maxUnitsInput.oninput = () => { populateOptions(); renderCategoryTrendChart(selector.value, data, months); };

            selector.onchange = () => renderCategoryTrendChart(selector.value, data, months);

            let prevBtn = document.getElementById('categoryPrevBtn');
            let nextBtn = document.getElementById('categoryNextBtn');
            if (prevBtn && nextBtn) {
                prevBtn.onclick = () => {
                    if (selector.selectedIndex > 0) {
                        selector.selectedIndex--;
                        selector.dispatchEvent(new Event('change'));
                    }
                };
                nextBtn.onclick = () => {
                    if (selector.selectedIndex < selector.options.length - 1) {
                        selector.selectedIndex++;
                        selector.dispatchEvent(new Event('change'));
                    }
                };
            }
        };

        if (!selector.dataset.initialized) {
            selector.dataset.initialized = "true";
        }

        populateOptions();
        attachHandlers();
        renderCategoryTrendChart(selector.value, data, months);
    }

    renderCategoryTable('categoryTableA', categoryTableMonthA, data, categorySortA);
    renderCategoryTable('categoryTableB', categoryTableMonthB, data, categorySortB);

    // Category Rising & Falling Stars
    const latest = months[months.length - 1];
    const prev = months.length > 1 ? months[months.length - 2] : null;
    if (latest && prev) {
        renderRisingFallingStars('category', latest, prev, data, 'categoryRisingStars', 'categoryFallingStars');
    }
}

function renderCategoryTrendChart(category, data, months) {
    let filteredRows;
    let chartData;
    if (category === '__ALL__') {
        filteredRows = data.filter(d => months.includes(d['Reporting Month']));
        chartData = months.map(m => data.filter(d => d['Reporting Month'] === m).reduce((s, d) => s + (d['N. Revenue'] || 0), 0));
    } else {
        filteredRows = data.filter(d => months.includes(d['Reporting Month']) && getCategoryNames(d).includes(category));
        chartData = months.map(m => {
            return data.filter(d => d['Reporting Month'] === m && getCategoryNames(d).includes(category))
                       .reduce((s, d) => s + (d['N. Revenue'] || 0), 0);
        });
    }
    updateTrendSummary('categoryTrend', calculateTrendSummary(filteredRows, months));
    renderLineChart('categoryTrendChart', months.map(formatMonthLabel), { label: 'Net Revenue (\u00A3)', data: chartData, color: '#009640' });
}

function renderCategoryTable(tableId, targetMonth, data, sortState) {
    const tbody = document.querySelector('#' + tableId + ' tbody');
    if (!tbody) return;
    
    const prev = getPrevMonth(targetMonth);
    const yoy = getYoyMonth(targetMonth);
    
    const getCategoryStats = (month) => {
        let stats = {};
        data.filter(d => d['Reporting Month'] === month).forEach(d => {
            getCategoryNames(d).forEach(cat => {
                if (!stats[cat]) stats[cat] = { name: cat, units: 0, revenue: 0 };
                stats[cat].units += (d['Units'] || 0);
                stats[cat].revenue += (d['N. Revenue'] || 0);
            });
        });
        return stats;
    };

    const curStats = getCategoryStats(targetMonth);
    const prevStats = getCategoryStats(prev);
    const yoyStats = getCategoryStats(yoy);
    
    let rows = Object.values(curStats).map(r => {
        let pRev = prevStats[r.name] ? prevStats[r.name].revenue : 0;
        let yRev = yoyStats[r.name] ? yoyStats[r.name].revenue : 0;
        return {
            name: r.name, units: r.units, revenue: r.revenue,
            prevMom: pRev > 0 ? ((r.revenue - pRev) / pRev) * 100 : 0,
            yoy: yRev > 0 ? ((r.revenue - yRev) / yRev) * 100 : 0
        };
    });
    
    // Sort
    rows.sort((a, b) => {
        let va = a[sortState.col], vb = b[sortState.col];
        if (typeof va === 'string') { va = va.toLowerCase(); vb = vb.toLowerCase(); }
        return sortState.dir === 'asc' ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1);
    });
    
    tbody.innerHTML = '';
    rows.forEach(r => {
        let tr = document.createElement('tr');
        let pStyle = r.prevMom > 0 ? 'color:#009640' : r.prevMom < 0 ? 'color:#EF4444' : '';
        let yStyle = r.yoy > 0 ? 'color:#009640' : r.yoy < 0 ? 'color:#EF4444' : '';
        tr.innerHTML = '<td>' + r.name + '</td><td>' + r.units + '</td><td>\u00A3' + r.revenue.toLocaleString() + '</td><td style="' + pStyle + '">' + (r.prevMom > 0 ? '+' : '') + r.prevMom.toFixed(1) + '%</td><td style="' + yStyle + '">' + (r.yoy > 0 ? '+' : '') + r.yoy.toFixed(1) + '%</td>';
        tbody.appendChild(tr);
    });

    // Sort click handlers
    document.querySelectorAll('#' + tableId + ' th[data-sort]').forEach(th => {
        th.onclick = () => {
            let col = th.getAttribute('data-sort');
            if (sortState.col === col) sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc';
            else { sortState.col = col; sortState.dir = 'desc'; }
            renderCategoryTable(tableId, targetMonth, data, sortState);
        };
    });
}

function updatePaymentDashboard() {
    const data = appData.payment;
    if (!data || data.length === 0) return;
    const mA = paymentMonthA;
    const mB = paymentMonthB;
    
    const dataA = data.filter(d => d['Reporting Month'] === mA);
    const dataB = data.filter(d => d['Reporting Month'] === mB);
    
    renderPieChart('paymentPieChart', dataA.map(d => d['Payment Gateway']), dataA.map(d => d['Revenue']));
    renderPieChart('paymentPieChartB', dataB.map(d => d['Payment Gateway']), dataB.map(d => d['Revenue']));
    
    let tbody = document.querySelector('#paymentHistoryTable tbody');
    if (tbody) {
        tbody.innerHTML = '';
        let allGateways = [...new Set([...dataA.map(d => d['Payment Gateway']), ...dataB.map(d => d['Payment Gateway'])])];
        allGateways.forEach(gw => {
            let a = dataA.find(d => d['Payment Gateway'] === gw) || {};
            let b = dataB.find(d => d['Payment Gateway'] === gw) || {};
            let tr = document.createElement('tr');
            tr.innerHTML = '<td>' + gw + '</td><td>' + (a.Orders || 0) + '</td><td>\u00A3' + (a.Revenue || 0).toLocaleString() + '</td><td>' + (b.Orders || 0) + '</td><td>\u00A3' + (b.Revenue || 0).toLocaleString() + '</td>';
            tbody.appendChild(tr);
        });
    }
    
    // Trend over range
    const months = getMonthsInRange();
    let totalRev = months.map(m => data.filter(d => d['Reporting Month'] === m).reduce((s, d) => s + (d['Revenue'] || 0), 0));
    renderLineChart('paymentTrendChart', months.map(formatMonthLabel), { label: 'Total Revenue (\u00A3)', data: totalRev, color: '#009640' });
}

// ===== CHART RENDERERS =====

const dlOff = { plugins: { datalabels: { display: false } } };

function renderDonutChart(canvasId, labels, data, colors) {
    var canvas = document.getElementById(canvasId);
    if (!canvas) return;
    if (window[canvasId] instanceof Chart) window[canvasId].destroy();
    window[canvasId] = new Chart(canvas.getContext('2d'), {
        type: 'doughnut',
        data: { labels: labels, datasets: [{ data: data, backgroundColor: colors, borderWidth: 0 }] },
        options: { responsive: true, maintainAspectRatio: false, cutout: '70%',
            plugins: { datalabels: { color: '#fff', font: { size: 12, weight: 700 }, formatter: (v) => v > 0 ? v : '' } } }
    });
}

function renderPieChart(canvasId, labels, data) {
    var canvas = document.getElementById(canvasId);
    if (!canvas) return;
    if (window[canvasId] instanceof Chart) window[canvasId].destroy();
    window[canvasId] = new Chart(canvas.getContext('2d'), {
        type: 'pie',
        data: { labels: labels, datasets: [{ data: data, backgroundColor: ['#009640','#FFE600','#373737','#3B82F6','#EF4444','#8B5CF6'], borderWidth: 0 }] },
        options: { responsive: true, maintainAspectRatio: false,
            plugins: { datalabels: { color: '#fff', font: { size: 11, weight: 700 }, formatter: (v) => '\u00A3' + Math.round(v).toLocaleString() } } }
    });
}

function renderBarChart(canvasId, labels, data, datasetLabel, color, axis) {
    var canvas = document.getElementById(canvasId);
    if (!canvas) return;
    if (window[canvasId] instanceof Chart) window[canvasId].destroy();
    window[canvasId] = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: { labels: labels, datasets: [{ label: datasetLabel, data: data, backgroundColor: color }] },
        options: { responsive: true, maintainAspectRatio: false, indexAxis: axis || 'x' }
    });
}

function renderLineChart(canvasId, labels, dataObj) {
    var canvas = document.getElementById(canvasId);
    if (!canvas) return;
    if (window[canvasId] instanceof Chart) window[canvasId].destroy();
    window[canvasId] = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: { labels: labels, datasets: [{
            label: dataObj.label, data: dataObj.data,
            borderColor: dataObj.color || '#009640', backgroundColor: 'rgba(0,150,64,0.1)',
            fill: true, tension: 0.3, borderWidth: 2, pointBackgroundColor: dataObj.color || '#009640'
        }] },
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } },
            plugins: { datalabels: { display: function(ctx) { return ctx.dataIndex % 2 === 0 && ctx.dataset.data[ctx.dataIndex] > 0; },
                formatter: (v) => Math.round(v).toLocaleString() } } }
    });
}

function renderMultiLineChart(canvasId, labels, datasets) {
    var canvas = document.getElementById(canvasId);
    if (!canvas) return;
    if (window[canvasId] instanceof Chart) window[canvasId].destroy();
    let dsets = datasets.map((ds, i) => ({
        label: ds.label, data: ds.data,
        borderColor: ds.color, backgroundColor: 'transparent',
        tension: 0.3, borderWidth: 2, pointBackgroundColor: ds.color,
        yAxisID: ds.yAxisID || 'y'
    }));
    let opts = { responsive: true, maintainAspectRatio: false,
        scales: { y: { beginAtZero: true, position: 'left' } },
        plugins: { datalabels: { display: false } } };
    if (datasets.some(ds => ds.yAxisID === 'y1')) {
        opts.scales.y1 = { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false } };
    }
    window[canvasId] = new Chart(canvas.getContext('2d'), { type: 'line', data: { labels: labels, datasets: dsets }, options: opts });
}

function renderStackedBarChart(canvasId, labels, datasets) {
    var canvas = document.getElementById(canvasId);
    if (!canvas) return;
    if (window[canvasId] instanceof Chart) window[canvasId].destroy();
    window[canvasId] = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: { labels: labels, datasets: datasets },
        options: { responsive: true, maintainAspectRatio: false, scales: { x: { stacked: false }, y: { stacked: false } } }
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





function updateCategoryBrowser() {
    const data = appData.product;
    if (!data || data.length === 0) return;
    
    let select = document.getElementById('categoryBrowserSelect');
    let title = document.getElementById('categoryBrowserTitle');
    let tbody = document.querySelector('#categoryBrowserTable tbody');
    if (!select || !tbody) return;

    let categories = new Set();
    data.forEach(d => {
        getCategoryNames(d).forEach(c => categories.add(c));
    });

    const currentCategory = select.value;
    select.innerHTML = '<option value="">Select a category...</option>';
    Array.from(categories).sort().forEach(cat => {
        let opt = document.createElement('option');
        opt.value = cat;
        opt.textContent = cat;
        select.appendChild(opt);
    });
    if (currentCategory && categories.has(currentCategory)) select.value = currentCategory;

    const renderBrowserTable = () => {
        let cat = select.value;
        if (!cat) {
            tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; padding:2rem; color:#94A3B8;">Select a category to see products</td></tr>';
            return;
        }
        title.textContent = 'Products in Category: ' + cat;
        
        let seenSkus = new Set();
        let products = data.filter(d => {
            if (!d.Category || !d.SKU) return false;
            let match = getCategoryNames(d).includes(cat);
            if (match && !seenSkus.has(d.SKU)) {
                seenSkus.add(d.SKU);
                return true;
            }
            return false;
        });

        tbody.innerHTML = '';
        products.forEach(p => {
            let tr = document.createElement('tr');
            tr.innerHTML = '<td>' + p.SKU + '</td><td>' + (p['Product title'] || '') + '</td><td style="font-size:0.8rem; color:#64748B;">' + (p.Category || '') + '</td>';
            tbody.appendChild(tr);
        });
    };

    select.onchange = renderBrowserTable;
    renderBrowserTable();
}

function updateBasketDashboard() {
    const data = normalizeBasketRows(appData.basket);
    if (!data || data.length === 0) return;
    
    const filterInput = document.getElementById('basketFilter');
    const tbody = document.querySelector('#basketTable tbody');
    if (!tbody) return;

    const renderTable = () => {
        let term = filterInput ? filterInput.value.toLowerCase() : "";
        let filtered = data;
        if (term) {
            filtered = data.filter(d => 
                String(d['Product A'] || "").toLowerCase().includes(term) ||
                String(d['Product B'] || "").toLowerCase().includes(term)
            );
        }

        tbody.innerHTML = '';
        filtered.slice(0, 100).forEach(d => {
            let tr = document.createElement('tr');
            let productACell = document.createElement('td');
            let productBCell = document.createElement('td');
            let countCell = document.createElement('td');
            productACell.textContent = d['Product A'];
            productBCell.textContent = d['Product B'];
            countCell.textContent = d['Times Bought Together'];
            countCell.style.fontWeight = '600';
            countCell.style.color = '#009640';
            countCell.style.textAlign = 'center';
            tr.appendChild(productACell);
            tr.appendChild(productBCell);
            tr.appendChild(countCell);
            tbody.appendChild(tr);
        });

        let top10 = filtered.slice(0, 10);
        renderBarChart('basketTopPairsChart', top10.map(d => String(d['Product A']).substring(0,15) + ' + ' + String(d['Product B']).substring(0,15)), top10.map(d => d['Times Bought Together']), 'Pairings', '#009640', 'y');
        
        let bins = { "3-5": 0, "6-10": 0, "11-20": 0, "21+": 0 };
        filtered.forEach(d => {
            let v = d['Times Bought Together'];
            if (v <= 5) bins["3-5"]++;
            else if (v <= 10) bins["6-10"]++;
            else if (v <= 20) bins["11-20"]++;
            else bins["21+"]++;
        });
        renderBarChart('basketDistChart', Object.keys(bins), Object.values(bins), 'No. of Pairs', '#373737', 'x');
    };

    if (filterInput) filterInput.oninput = renderTable;
    renderTable();

    // 1. Project vs Maintenance
    if (appData.basketProject && appData.basketProject.length > 0) {
        let projBaskets = 0, maintBaskets = 0;
        let projRev = 0, projCount = 0;
        let maintRev = 0, maintCount = 0;
        appData.basketProject.forEach(d => {
            if (d['Basket Type'] === 'Project Basket') {
                projBaskets += (d['Total Baskets'] || 0);
                projRev += (d['Total Revenue'] || 0);
                projCount += (d['Total Baskets'] || 0);
            } else if (d['Basket Type'] === 'Maintenance Basket') {
                maintBaskets += (d['Total Baskets'] || 0);
                maintRev += (d['Total Revenue'] || 0);
                maintCount += (d['Total Baskets'] || 0);
            }
        });
        
        let projAov = projCount > 0 ? (projRev / projCount) : 0;
        let maintAov = maintCount > 0 ? (maintRev / maintCount) : 0;
        
        let pMetric = document.getElementById('projectAovMetric');
        let mMetric = document.getElementById('maintenanceAovMetric');
        if (pMetric) pMetric.textContent = '£' + Math.round(projAov).toLocaleString();
        if (mMetric) mMetric.textContent = '£' + Math.round(maintAov).toLocaleString();

        let canvas = document.getElementById('basketProjectSplitChart');
        if (canvas) {
            if (window['basketProjectSplitChart'] instanceof Chart) window['basketProjectSplitChart'].destroy();
            window['basketProjectSplitChart'] = new Chart(canvas.getContext('2d'), {
                type: 'doughnut',
                data: { labels: ['Project', 'Maintenance'], datasets: [{ data: [projBaskets, maintBaskets], backgroundColor: ['#F59E0B', '#3B82F6'] }] },
                options: { responsive: true, maintainAspectRatio: false, plugins: { datalabels: { color: '#fff', formatter: (val, ctx) => { let sum = ctx.dataset.data.reduce((a,b)=>a+b,0); return sum > 0 ? Math.round((val*100)/sum) + '%' : ''; } } } }
            });
        }
    }

    // 2. Cross-Category
    if (appData.basketCrossCategory && appData.basketCrossCategory.length > 0) {
        let multi = 0, single = 0;
        appData.basketCrossCategory.forEach(d => {
            if (d['Cross-Category Status'] === 'Multi-Category Basket') multi += (d['Total Baskets'] || 0);
            else single += (d['Total Baskets'] || 0);
        });
        
        let canvas = document.getElementById('crossCategoryGauge');
        if (canvas) {
            if (window['crossCategoryGauge'] instanceof Chart) window['crossCategoryGauge'].destroy();
            window['crossCategoryGauge'] = new Chart(canvas.getContext('2d'), {
                type: 'doughnut',
                data: { labels: ['Multi-Category', 'Single-Category'], datasets: [{ data: [multi, single], backgroundColor: ['#8B5CF6', '#E2E8F0'] }] },
                options: { rotation: -90, circumference: 180, responsive: true, maintainAspectRatio: false, plugins: { datalabels: { color: '#fff', formatter: (val, ctx) => { let sum = ctx.dataset.data.reduce((a,b)=>a+b,0); return sum > 0 ? Math.round((val*100)/sum) + '%' : ''; } } } }
            });
        }
    }

    // 3. Consumables Table
    if (appData.basketConsumables && appData.basketConsumables.length > 0) {
        const cBody = document.querySelector('#consumableVelocityTable tbody');
        if (cBody) {
            cBody.innerHTML = '';
            let sorted = [...appData.basketConsumables].sort((a,b) => (b['Total Repeat Buyers']||0) - (a['Total Repeat Buyers']||0));
            sorted.slice(0, 50).forEach(d => {
                let tr = document.createElement('tr');
                tr.innerHTML = '<td>' + (d['Product Name']||'') + '</td><td>' + (d['Category']||'') + '</td><td style="text-align:center;">' + (d['Average Days to Repurchase']||0) + ' days</td><td style="font-weight:600; color:#009640; text-align:center;">' + (d['Total Repeat Buyers']||0) + '</td>';
                cBody.appendChild(tr);
            });
        }
    }

    // 4. AOV Multipliers
    if (appData.basketAnchors && appData.basketAnchors.length > 0) {
        let anchorStats = {};
        appData.basketAnchors.forEach(d => {
            let name = d['Product Name'];
            if (!name) return;
            if (!anchorStats[name]) anchorStats[name] = { orders: 0, basketRev: 0 };
            anchorStats[name].orders += (d['Total Orders Containing Item'] || 0);
            anchorStats[name].basketRev += (d['Total Basket Revenue'] || 0);
        });
        
        let anchorList = Object.keys(anchorStats).map(name => {
            let s = anchorStats[name];
            return { name: name, avgAov: s.orders > 0 ? (s.basketRev / s.orders) : 0, orders: s.orders };
        });
        
        let topAnchors = anchorList.sort((a,b) => b.avgAov - a.avgAov).filter(a => a.orders > 3).slice(0, 10);
        if (topAnchors.length === 0) topAnchors = anchorList.sort((a,b) => b.avgAov - a.avgAov).slice(0, 10);
        
        renderBarChart('aovMultipliersChart', topAnchors.map(a => a.name.substring(0, 25)), topAnchors.map(a => Math.round(a.avgAov)), 'Avg Basket Value (£)', '#EF4444', 'y');
    }
}


function renderRisingFallingStars(type, month, prevMonth, data, risingTableId, fallingTableId) {
    const risingTbody = document.querySelector('#' + risingTableId + ' tbody');
    const fallingTbody = document.querySelector('#' + fallingTableId + ' tbody');
    if (!risingTbody || !fallingTbody) return;

    let stats = {};
    
    if (type === 'product') {
        data.filter(d => d['Reporting Month'] === month).forEach(d => {
            if (!d.SKU) return;
            if (!stats[d.SKU]) stats[d.SKU] = { name: d['Product title'], curRev: 0, prevRev: 0, sku: d.SKU };
            stats[d.SKU].curRev += (d['N. Revenue'] || 0);
        });
        data.filter(d => d['Reporting Month'] === prevMonth).forEach(d => {
            if (!d.SKU) return;
            if (!stats[d.SKU]) stats[d.SKU] = { name: d['Product title'], curRev: 0, prevRev: 0, sku: d.SKU };
            stats[d.SKU].prevRev += (d['N. Revenue'] || 0);
        });
    } else {
        data.filter(d => d['Reporting Month'] === month).forEach(d => {
            getCategoryNames(d).forEach(cat => {
                if (!stats[cat]) stats[cat] = { name: cat, curRev: 0, prevRev: 0 };
                stats[cat].curRev += (d['N. Revenue'] || 0);
            });
        });
        data.filter(d => d['Reporting Month'] === prevMonth).forEach(d => {
            getCategoryNames(d).forEach(cat => {
                if (!stats[cat]) stats[cat] = { name: cat, curRev: 0, prevRev: 0 };
                stats[cat].prevRev += (d['N. Revenue'] || 0);
            });
        });
    }

    let items = Object.values(stats).map(i => {
        i.diff = i.curRev - i.prevRev;
        return i;
    });

    let rising = items.filter(i => i.diff > 0).sort((a, b) => b.diff - a.diff).slice(0, 10);
    risingTbody.innerHTML = '';
    rising.forEach(i => {
        let tr = document.createElement('tr');
        if (type === 'product') {
            tr.innerHTML = '<td>' + i.sku + '</td><td>' + i.name + '</td><td>\u00A3' + i.prevRev.toLocaleString() + '</td><td>\u00A3' + i.curRev.toLocaleString() + '</td><td style="color:#009640; font-weight:600;">+\u00A3' + i.diff.toLocaleString() + '</td>';
        } else {
            tr.innerHTML = '<td>' + i.name + '</td><td>\u00A3' + i.prevRev.toLocaleString() + '</td><td>\u00A3' + i.curRev.toLocaleString() + '</td><td style="color:#009640; font-weight:600;">+\u00A3' + i.diff.toLocaleString() + '</td>';
        }
        risingTbody.appendChild(tr);
    });

    let falling = items.filter(i => i.diff < 0 && i.prevRev >= 500).sort((a, b) => a.diff - b.diff).slice(0, 10);
    fallingTbody.innerHTML = '';
    falling.forEach(i => {
        let tr = document.createElement('tr');
        if (type === 'product') {
            tr.innerHTML = '<td>' + i.sku + '</td><td>' + i.name + '</td><td>\u00A3' + i.prevRev.toLocaleString() + '</td><td>\u00A3' + i.curRev.toLocaleString() + '</td><td style="color:#EF4444; font-weight:600;">-\u00A3' + Math.abs(i.diff).toLocaleString() + '</td>';
        } else {
            tr.innerHTML = '<td>' + i.name + '</td><td>\u00A3' + i.prevRev.toLocaleString() + '</td><td>\u00A3' + i.curRev.toLocaleString() + '</td><td style="color:#EF4444; font-weight:600;">-\u00A3' + Math.abs(i.diff).toLocaleString() + '</td>';
        }
        fallingTbody.appendChild(tr);
    });
}

// Export Filtered Products
function exportFilteredProducts() {
    if (!window.lastFilteredProducts || window.lastFilteredProducts.length === 0) {
        alert("No products to export based on current filters.");
        return;
    }
    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += "SKU,Product Name,Total Units Sold,Total Revenue (£)\n";
    window.lastFilteredProducts.forEach(p => {
        let name = p.name ? p.name.replace(/"/g, '""') : '';
        csvContent += `"${p.sku}","${name}",${p.totalUnits},${p.totalRev.toFixed(2)}\n`;
    });
    let encodedUri = encodeURI(csvContent);
    let link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "filtered_products.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// Export Filtered Categories
function exportFilteredCategories() {
    if (!window.lastFilteredCategories || window.lastFilteredCategories.length === 0) {
        alert("No categories to export based on current filters.");
        return;
    }
    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += "Category Name,Total Units Sold,Total Revenue (£)\n";
    window.lastFilteredCategories.forEach(c => {
        let name = c.name ? c.name.replace(/"/g, '""') : '';
        csvContent += `"${name}",${c.totalUnits},${c.totalRev.toFixed(2)}\n`;
    });
    let encodedUri = encodeURI(csvContent);
    let link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "filtered_categories.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
