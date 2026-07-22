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
    aiReferral: null,
    activityLog: {},
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
let productCompMonthA = "";
let productCompMonthB = "";
let productCompRangeMode = "single"; // "single" or "range"
let productCompStartA = "";
let productCompEndA = "";
let productCompStartB = "";
let productCompEndB = "";
let productCompMode = "yoy"; // "yoy", "mom", "summer", "autumn", or "custom"
let productCompSortCol = "diffRev";
let productCompSortDir = "asc";
let categoryTableMonthA = "";
let categoryTableMonthB = "";
let selectedProductSalesSku = "";

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
if (window['chartjs-plugin-annotation']) {
    Chart.register(window['chartjs-plugin-annotation']);
}
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
    pm_price.meta_value AS \`Catalog Price\`,
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
LEFT JOIN (
    SELECT post_id, MAX(meta_value) AS meta_value
    FROM wp_postmeta
    WHERE meta_key = '_sku'
    GROUP BY post_id
) pm_sku
    ON pm_sku.post_id = CASE
        WHEN opl.variation_id > 0 THEN opl.variation_id
        ELSE opl.product_id
    END
LEFT JOIN (
    SELECT post_id, MAX(meta_value) AS meta_value
    FROM wp_postmeta
    WHERE meta_key = '_price'
    GROUP BY post_id
) pm_price
    ON pm_price.post_id = CASE
        WHEN opl.variation_id > 0 THEN opl.variation_id
        ELSE opl.product_id
    END
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
    (
        SELECT GROUP_CONCAT(t.name SEPARATOR ', ')
        FROM wp_term_relationships tr
        JOIN wp_term_taxonomy tt
            ON tt.term_taxonomy_id = tr.term_taxonomy_id
           AND tt.taxonomy = 'product_cat'
        JOIN wp_terms t
            ON t.term_id = tt.term_id
        WHERE tr.object_id = opl.product_id
    ) AS \`Category\`,
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
        },
        {
            title: "12. AI Referral Acquisition",
            query: `SELECT 
    DATE_FORMAT(p.post_date, '%Y-%m') AS \`Reporting Month\`,
    CASE 
        WHEN LOWER(pm_ref.meta_value) LIKE '%gemini.google.com%' OR LOWER(pm_utm.meta_value) LIKE '%gemini%' THEN 'Gemini'
        WHEN LOWER(pm_ref.meta_value) LIKE '%chatgpt.com%' OR LOWER(pm_utm.meta_value) LIKE '%chatgpt%' OR LOWER(pm_ref.meta_value) LIKE '%openai.com%' THEN 'ChatGPT'
        WHEN LOWER(pm_ref.meta_value) LIKE '%claude.ai%' OR LOWER(pm_utm.meta_value) LIKE '%claude%' THEN 'Claude'
        WHEN LOWER(pm_ref.meta_value) LIKE '%perplexity.ai%' OR LOWER(pm_utm.meta_value) LIKE '%perplexity%' THEN 'Perplexity'
        WHEN LOWER(pm_ref.meta_value) LIKE '%copilot.microsoft.com%' OR LOWER(pm_utm.meta_value) LIKE '%copilot%' THEN 'Copilot'
        ELSE 'Other AI'
    END AS \`AI Engine\`,
    COUNT(DISTINCT p.ID) AS \`Orders\`,
    SUM(pm_total.meta_value) AS \`Revenue\`,
    SUM(pm_total.meta_value) / COUNT(DISTINCT p.ID) AS \`Average Order Value\`
FROM wp_posts p
JOIN wp_postmeta pm_total ON p.ID = pm_total.post_id AND pm_total.meta_key = '_order_total'
LEFT JOIN wp_postmeta pm_ref ON p.ID = pm_ref.post_id 
    AND pm_ref.meta_key IN ('_wc_order_attribution_referrer', '_referrer', '_http_referrer', '_ga_referrer')
LEFT JOIN wp_postmeta pm_utm ON p.ID = pm_utm.post_id 
    AND pm_utm.meta_key IN ('_wc_order_attribution_utm_source', '_utm_source', 'source')
WHERE p.post_type = 'shop_order' 
  AND p.post_status NOT IN ('wc-pending', 'wc-cancelled', 'wc-refunded', 'wc-failed', 'trash', 'wc-trash')
  AND (
      LOWER(pm_ref.meta_value) LIKE '%gemini.google.com%' OR LOWER(pm_utm.meta_value) LIKE '%gemini%'
      OR LOWER(pm_ref.meta_value) LIKE '%chatgpt.com%' OR LOWER(pm_utm.meta_value) LIKE '%chatgpt%' OR LOWER(pm_ref.meta_value) LIKE '%openai.com%'
      OR LOWER(pm_ref.meta_value) LIKE '%claude.ai%' OR LOWER(pm_utm.meta_value) LIKE '%claude%'
      OR LOWER(pm_ref.meta_value) LIKE '%perplexity.ai%' OR LOWER(pm_utm.meta_value) LIKE '%perplexity%'
      OR LOWER(pm_ref.meta_value) LIKE '%copilot.microsoft.com%' OR LOWER(pm_utm.meta_value) LIKE '%copilot%'
  )
  AND p.post_date >= DATE_SUB(CURDATE(), INTERVAL 24 MONTH)
GROUP BY \`Reporting Month\`, \`AI Engine\`
ORDER BY \`Reporting Month\` DESC, \`Revenue\` DESC;`
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

    // Product Performance Variance Engine pickers & Range Mode
    const pCompA = document.getElementById('productCompMonthA');
    const pCompB = document.getElementById('productCompMonthB');
    const pStartA = document.getElementById('productCompStartA');
    const pEndA = document.getElementById('productCompEndA');
    const pStartB = document.getElementById('productCompStartB');
    const pEndB = document.getElementById('productCompEndB');

    const btnSingleMode = document.getElementById('productModeSingle');
    const btnRangeMode = document.getElementById('productModeRange');
    const rowSingle = document.getElementById('productSinglePickersRow');
    const rowRange = document.getElementById('productRangePickersRow');

    const pPresetYoY = document.getElementById('productPresetYoY');
    const pPresetMoM = document.getElementById('productPresetMoM');
    const pPresetSummer = document.getElementById('productPresetSummer');
    const pPresetAutumn = document.getElementById('productPresetAutumn');

    if (pCompA && pCompB) {
        let defYoY = getYoyMonth(defA);
        pCompA.value = defA;
        pCompB.value = defYoY;
        productCompMonthA = defA;
        productCompMonthB = defYoY;
        productCompMode = 'yoy';

        // Default range defaults (Summer May-Aug)
        let curYear = defA ? defA.split('-')[0] : '2026';
        let prevYear = String(Number(curYear) - 1);
        if (pStartA && pEndA && pStartB && pEndB) {
            pStartA.value = `${curYear}-05`; pEndA.value = `${curYear}-08`;
            pStartB.value = `${prevYear}-05`; pEndB.value = `${prevYear}-08`;
            productCompStartA = pStartA.value; productCompEndA = pEndA.value;
            productCompStartB = pStartB.value; productCompEndB = pEndB.value;
        }

        const setUIMode = (mode) => {
            productCompRangeMode = mode;
            if (mode === 'range') {
                if (btnSingleMode) btnSingleMode.className = 'btn-secondary';
                if (btnRangeMode) btnRangeMode.className = 'btn-primary';
                if (rowSingle) rowSingle.style.display = 'none';
                if (rowRange) rowRange.style.display = 'flex';
            } else {
                if (btnSingleMode) btnSingleMode.className = 'btn-primary';
                if (btnRangeMode) btnRangeMode.className = 'btn-secondary';
                if (rowSingle) rowSingle.style.display = 'flex';
                if (rowRange) rowRange.style.display = 'none';
            }
        };

        if (btnSingleMode) btnSingleMode.addEventListener('click', () => { setUIMode('single'); updateDashboards(); });
        if (btnRangeMode) btnRangeMode.addEventListener('click', () => { setUIMode('range'); updateDashboards(); });

        pCompA.addEventListener('change', () => {
            productCompMonthA = pCompA.value;
            if (productCompMode === 'yoy') {
                productCompMonthB = getYoyMonth(productCompMonthA);
                pCompB.value = productCompMonthB;
            } else if (productCompMode === 'mom') {
                productCompMonthB = getPrevMonth(productCompMonthA);
                pCompB.value = productCompMonthB;
            }
            updateDashboards();
        });

        pCompB.addEventListener('change', () => {
            productCompMonthB = pCompB.value;
            productCompMode = 'custom';
            updateDashboards();
        });

        const bindRangeChange = (el, propName) => {
            if (el) {
                el.addEventListener('change', () => {
                    if (propName === 'startA') productCompStartA = el.value;
                    if (propName === 'endA') productCompEndA = el.value;
                    if (propName === 'startB') productCompStartB = el.value;
                    if (propName === 'endB') productCompEndB = el.value;
                    setUIMode('range');
                    updateDashboards();
                });
            }
        };
        bindRangeChange(pStartA, 'startA');
        bindRangeChange(pEndA, 'endA');
        bindRangeChange(pStartB, 'startB');
        bindRangeChange(pEndB, 'endB');

        if (pPresetYoY) {
            pPresetYoY.addEventListener('click', () => {
                setUIMode('single');
                productCompMode = 'yoy';
                productCompMonthB = getYoyMonth(productCompMonthA);
                pCompB.value = productCompMonthB;
                updateDashboards();
            });
        }

        if (pPresetMoM) {
            pPresetMoM.addEventListener('click', () => {
                setUIMode('single');
                productCompMode = 'mom';
                productCompMonthB = getPrevMonth(productCompMonthA);
                pCompB.value = productCompMonthB;
                updateDashboards();
            });
        }

        if (pPresetSummer) {
            pPresetSummer.addEventListener('click', () => {
                setUIMode('range');
                productCompMode = 'summer';
                let yr = productCompMonthA ? productCompMonthA.split('-')[0] : '2026';
                let pYr = String(Number(yr) - 1);
                if (pStartA && pEndA && pStartB && pEndB) {
                    pStartA.value = `${yr}-05`; pEndA.value = `${yr}-08`;
                    pStartB.value = `${pYr}-05`; pEndB.value = `${pYr}-08`;
                    productCompStartA = pStartA.value; productCompEndA = pEndA.value;
                    productCompStartB = pStartB.value; productCompEndB = pEndB.value;
                }
                updateDashboards();
            });
        }

        if (pPresetAutumn) {
            pPresetAutumn.addEventListener('click', () => {
                setUIMode('range');
                productCompMode = 'autumn';
                let yr = '2025';
                let pYr = '2024';
                if (pStartA && pEndA && pStartB && pEndB) {
                    pStartA.value = `${yr}-09`; pEndA.value = `${yr}-12`;
                    pStartB.value = `${pYr}-09`; pEndB.value = `${pYr}-12`;
                    productCompStartA = pStartA.value; productCompEndA = pEndA.value;
                    productCompStartB = pStartB.value; productCompEndB = pEndB.value;
                }
                updateDashboards();
            });
        }
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
                if (btn.getAttribute('data-target') === 'tab-productsales') updateProductSalesDashboard();
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
                        } else if (fields.includes('AI Engine') && fields.includes('Reporting Month')) {
                            recordLoad('aiReferral', 'AI Referrals');
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

function getProductKey(row) {
    if (!row) return 'Unknown';
    let sku = row.SKU;
    if (!sku || sku === "" || sku.toLowerCase() === "null") {
        return "NO_SKU_" + (row['Product title'] || 'Unknown').trim();
    }
    return sku.trim();
}

function getDisplaySku(sku) {
    if (!sku || sku === "" || sku.toLowerCase() === "null" || sku.startsWith("NO_SKU_")) {
        return "NULL";
    }
    return sku.trim();
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
    if (appData.customer || appData.aiReferral) updateCustomerDashboard();
    if (appData.shipping) updateShippingDashboard();
    if (appData.product) {
        updateProductDashboard();
        updateCategoryDashboard();
        updateCategoryBrowser();
        updateProductSalesDashboard();
    }
    if (appData.basket || appData.basketProject || appData.basketConsumables || appData.basketAnchors || appData.basketCrossCategory) {
        updateBasketDashboard();
    }
    if (appData.payment) updatePaymentDashboard();
    updateActivityDashboard();
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
        { key: 'basketCrossCategory', name: 'Cross Category' },
        { key: 'aiReferral', name: 'AI Referral Acquisition' }
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

// ===== ACTIVITY LOG =====
function updateActivityDashboard() {
    const tbody = document.querySelector('#activityLogTable tbody');
    if (!tbody) return;
    
    tbody.innerHTML = '';
    const notes = appData.activityLog || {};
    const months = Object.keys(notes).sort().reverse();
    
    if (months.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" style="text-align: center; color: #64748B; font-style: italic;">No notes recorded yet.</td></tr>';
        return;
    }

    months.forEach(month => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="font-weight: 600;">${month}</td>
            <td style="white-space: pre-wrap;">${notes[month]}</td>
            <td style="text-align: right;">
                <button class="btn-secondary" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; margin-right: 0.5rem;" onclick="editActivityNote('${month}')">Edit</button>
                <button class="btn-secondary" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; border-color: #EF4444; color: #EF4444;" onclick="deleteActivityNote('${month}')">Delete</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function saveActivityNote() {
    const monthInput = document.getElementById('activityNoteMonth');
    const textInput = document.getElementById('activityNoteText');
    if (!monthInput || !textInput) return;
    
    const month = monthInput.value;
    const text = textInput.value.trim();
    
    if (!month) { alert("Please select a target month."); return; }
    if (!text) { alert("Please enter some text for the note."); return; }
    
    if (!appData.activityLog) appData.activityLog = {};
    appData.activityLog[month] = text;
    
    monthInput.value = '';
    textInput.value = '';
    
    updateDashboards();
}

function editActivityNote(month) {
    const monthInput = document.getElementById('activityNoteMonth');
    const textInput = document.getElementById('activityNoteText');
    if (!monthInput || !textInput || !appData.activityLog || !appData.activityLog[month]) return;
    
    monthInput.value = month;
    textInput.value = appData.activityLog[month];
    document.getElementById('tab-activity').scrollIntoView({ behavior: 'smooth' });
}

function deleteActivityNote(month) {
    if (!confirm('Are you sure you want to delete the note for ' + month + '?')) return;
    if (appData.activityLog && appData.activityLog[month]) {
        delete appData.activityLog[month];
        updateDashboards();
    }
}

function getChartAnnotationsConfigs(labels) {
    if (!appData.activityLog || Object.keys(appData.activityLog).length === 0) return {};
    
    const annotations = {};
    labels.forEach((label, index) => {
        // label might be 'Jan 24', let's match to '2024-01'
        const parts = label.split(' ');
        if (parts.length !== 2) return;
        const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
        const mIdx = monthNames.indexOf(parts[0]);
        if (mIdx === -1) return;
        const yearStr = '20' + parts[1];
        const monthStr = (mIdx + 1).toString().padStart(2, '0');
        const ym = yearStr + '-' + monthStr;
        
        if (appData.activityLog[ym]) {
            annotations['note' + index] = {
                type: 'point',
                xValue: label,
                yValue: 0, // bottom of the chart
                backgroundColor: '#8B5CF6',
                radius: 6,
                borderWidth: 2,
                borderColor: '#fff',
                label: {
                    content: 'Note', // Default shortened
                    display: false,
                    position: 'top',
                    backgroundColor: 'rgba(0,0,0,0.8)',
                    color: '#fff',
                    font: { size: 12 },
                    padding: 8
                },
                click({element}, event) {
                    const isOpen = element.options.label.display;
                    element.options.label.display = !isOpen;
                    if (!isOpen) {
                        // Word wrap the full text
                        const words = appData.activityLog[ym].split(' ');
                        const lines = [];
                        let currentLine = '';
                        words.forEach(w => {
                            if ((currentLine + w).length > 40) {
                                lines.push(currentLine.trim());
                                currentLine = w + ' ';
                            } else {
                                currentLine += w + ' ';
                            }
                        });
                        lines.push(currentLine.trim());
                        element.options.label.content = lines;
                    }
                    return true;
                },
                enter({element}, event) { 
                    document.body.style.cursor = 'pointer'; 
                },
                leave({element}, event) { 
                    document.body.style.cursor = 'default';
                }
            };
        }
    });
    
    return {
        annotation: {
            annotations: annotations
        }
    };
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
                { id: 'customerAovChart', title: 'AOV Comparison', desc: 'Bar chart comparing the Average Order Value of new vs repeat customers for both selected comparison months.' },
                { id: 'aiReferralTrendChart', title: 'AI Referral Acquisition Trend', desc: 'Line chart tracking monthly order referrals from AI recommendations (e.g., Gemini, ChatGPT, Claude) over the date range.' }
            ],
            tables: [
                { id: 'aiReferralTable', title: 'AI Engine Breakdown', desc: 'Summary of orders, revenue, and AOV generated by each AI engine.' }
            ]
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
            id: 'tab-productsales', name: 'Product Sales',
            kpis: [],
            charts: [
                { id: 'productSalesTrendChart', title: 'Product Sales Trend', desc: 'Dual-axis line chart showing revenue and units sold for the selected product.' }
            ],
            tables: [
                { id: 'productSalesTable', title: 'Product Sales Catalogue', desc: 'Ranked list of products sold over the selected date range, including units, revenue, and average unit price.' }
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
                { id: 'basketAovTrendChart', title: 'Average Basket Value Over Time', desc: 'Tracks the Average Order Value (AOV) of orders over time, filtered to orders containing at least one item from the selected category.' },
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
    if (appData.customer || appData.aiReferral) updateCustomerDashboard();
    if (appData.shipping) updateShippingDashboard();
    if (appData.product) {
        updateProductDashboard();
        updateCategoryDashboard();
    }
    if (appData.basket || appData.basketProject || appData.basketConsumables || appData.basketAnchors || appData.basketCrossCategory) {
        updateBasketDashboard();
    }
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
    if (data && data.length > 0) {
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
    
    updateAiReferralSection();
}

function updateAiReferralSection() {
    const noticeEl = document.getElementById('aiReferralNotice');
    const contentEl = document.getElementById('aiReferralContent');
    if (!noticeEl || !contentEl) return;

    if (!appData.aiReferral || appData.aiReferral.length === 0) {
        noticeEl.style.display = 'block';
        contentEl.style.display = 'none';
        return;
    }

    noticeEl.style.display = 'none';
    contentEl.style.display = 'block';

    const months = getMonthsInRange();
    const filteredData = appData.aiReferral.filter(d => months.includes(d['Reporting Month']));

    // 1. Calculate Metrics
    let totalAiOrders = 0;
    let totalAiRevenue = 0;
    filteredData.forEach(d => {
        totalAiOrders += parseCsvNumber(d['Orders']);
        totalAiRevenue += parseCsvNumber(d['Revenue']);
    });
    let aiAov = totalAiOrders > 0 ? (totalAiRevenue / totalAiOrders) : 0;

    let totalStoreOrders = 0;
    if (appData.executive) {
        totalStoreOrders = appData.executive
            .filter(d => months.includes(d['Reporting Month']))
            .reduce((sum, r) => sum + (r.total_orders || 0), 0);
    } else if (appData.customer) {
        totalStoreOrders = appData.customer
            .filter(d => months.includes(d['Reporting Month']))
            .reduce((sum, r) => sum + (r.total_orders || 0), 0);
    }

    let aiShare = totalStoreOrders > 0 ? ((totalAiOrders * 100) / totalStoreOrders).toFixed(2) + '%' : '--';

    setElementText('aiTotalOrders', formatWholeNumber(totalAiOrders));
    setElementText('aiTotalRevenue', formatCurrency(totalAiRevenue));
    setElementText('aiAov', formatCurrency(aiAov));
    setElementText('aiShare', aiShare);

    // 2. Populate Detail Table
    const tbody = document.querySelector('#aiReferralTable tbody');
    if (tbody) {
        tbody.innerHTML = '';
        // Group by Engine
        let engineGroups = {};
        filteredData.forEach(d => {
            let engine = d['AI Engine'] || 'Other AI';
            if (!engineGroups[engine]) {
                engineGroups[engine] = { orders: 0, revenue: 0 };
            }
            engineGroups[engine].orders += parseCsvNumber(d['Orders']);
            engineGroups[engine].revenue += parseCsvNumber(d['Revenue']);
        });

        // Sort by revenue
        let sortedEngines = Object.keys(engineGroups).map(engine => {
            let g = engineGroups[engine];
            return {
                engine: engine,
                orders: g.orders,
                revenue: g.revenue,
                aov: g.orders > 0 ? (g.revenue / g.orders) : 0
            };
        }).sort((a, b) => b.revenue - a.revenue);

        sortedEngines.forEach(e => {
            let tr = document.createElement('tr');
            tr.innerHTML = '<td>' + e.engine + '</td><td style="font-weight:600; text-align:center;">' + formatWholeNumber(e.orders) + '</td><td style="font-weight:600; color:#009640;">' + formatCurrency(e.revenue) + '</td><td>' + formatCurrency(e.aov) + '</td>';
            tbody.appendChild(tr);
        });
    }

    // 3. Render Multi-Line Chart
    // Find all unique AI Engines in the dataset
    let enginesSet = new Set();
    appData.aiReferral.forEach(d => {
        if (d['AI Engine']) enginesSet.add(d['AI Engine']);
    });
    let uniqueEngines = Array.from(enginesSet);

    // Colors Map
    const colorMap = {
        'Gemini': '#1A73E8',     // Google Blue
        'ChatGPT': '#10A37F',    // OpenAI Green
        'Claude': '#D97706',     // Anthropic Amber
        'Perplexity': '#00A3C4', // Perplexity Teal
        'Copilot': '#2563EB',    // Microsoft Blue
        'Other AI': '#64748B'    // Slate
    };

    let datasets = uniqueEngines.map(engine => {
        let monthlyData = months.map(m => {
            let row = filteredData.find(d => d['Reporting Month'] === m && d['AI Engine'] === engine);
            return row ? parseCsvNumber(row['Orders']) : 0;
        });
        return {
            label: engine,
            data: monthlyData,
            color: colorMap[engine] || '#64748B'
        };
    });

    renderMultiLineChart('aiReferralTrendChart', months.map(formatMonthLabel), datasets);
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

    // 1. Run Variance Engine
    renderProductVarianceEngine(data);

    // 2. Individual Product Sales Trend Chart (Bottom section)
    let selector = document.getElementById('productTrendSelector');
    let searchInput = document.getElementById('productSearch');
    const minRevInput = document.getElementById('productMinRev');
    const maxRevInput = document.getElementById('productMaxRev');
    
    if (selector && searchInput) {
        let productStats = new Map(); // key -> { name, totalRev, totalUnits }
        data.forEach(d => {
            if (!months.includes(d['Reporting Month'])) return;
            let key = getProductKey(d);
            if (!productStats.has(key)) {
                productStats.set(key, { name: d['Product title'] || 'Unknown', totalRev: 0, totalUnits: 0 });
            }
            let s = productStats.get(key);
            s.totalRev += (Number(d['N. Revenue']) || 0);
            s.totalUnits += (Number(d['Units']) || 0);
        });
        
        const populateOptions = () => {
            let filter = searchInput.value.toLowerCase();
            let minRev = parseFloat(minRevInput.value) || 0;
            let maxRev = parseFloat(maxRevInput.value) || Infinity;

            let currentSel = selector.value;
            selector.innerHTML = '<option value="__ALL__">All Products (Total Revenue)</option>';
            window.lastFilteredProducts = [];
            
            Array.from(productStats.keys()).sort().forEach(key => {
                let stats = productStats.get(key);
                let displaySku = getDisplaySku(key);
                let text = '[' + displaySku + '] ' + stats.name;
                
                if (filter && !text.toLowerCase().includes(filter)) return;
                if (stats.totalRev < minRev || stats.totalRev > maxRev) return;
                
                window.lastFilteredProducts.push({ sku: displaySku, name: stats.name, totalRev: stats.totalRev, totalUnits: stats.totalUnits });
                
                let opt = document.createElement('option');
                opt.value = key;
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

            selector.onchange = () => {
                renderProductTrendChart(selector.value, data, months);
            };
        };
        
        populateOptions();
        attachHandlers();
        
        renderProductTrendChart(selector.value, data, months);
    }
}

function renderProductTrendChart(skuKey, data, months) {
    let filteredRows;
    let chartData;
    if (skuKey === '__ALL__') {
        filteredRows = data.filter(d => months.includes(d['Reporting Month']));
        chartData = months.map(m => data.filter(d => d['Reporting Month'] === m).reduce((s, d) => s + (d['N. Revenue'] || 0), 0));
    } else {
        filteredRows = data.filter(d => months.includes(d['Reporting Month']) && getProductKey(d) === skuKey);
        chartData = months.map(m => {
            return data
                .filter(d => d['Reporting Month'] === m && getProductKey(d) === skuKey)
                .reduce((s, d) => s + (d['N. Revenue'] || 0), 0);
        });
    }
    updateTrendSummary('productTrend', calculateTrendSummary(filteredRows, months));
    renderLineChart('productTrendChart', months.map(formatMonthLabel), { label: 'Net Revenue (\u00A3)', data: chartData, color: '#009640' });
}

function findNearestHistoricalSale(data, productKey, targetMonthStr) {
    if (!data || !productKey || !targetMonthStr) return null;
    let matches = data.filter(d => {
        let key = getProductKey(d);
        let u = Number(d['Units']) || 0;
        let r = Number(d['N. Revenue']) || 0;
        return key === productKey && u > 0 && r > 0;
    });

    if (matches.length === 0) return null;

    let parts = targetMonthStr.split('-');
    if (parts.length < 2) return null;
    let targetIdx = Number(parts[0]) * 12 + Number(parts[1]);

    let bestMatch = null;
    let minDiff = Infinity;

    matches.forEach(m => {
        let mStr = m['Reporting Month'];
        if (!mStr) return;
        let mParts = mStr.split('-');
        if (mParts.length < 2) return;
        let idx = Number(mParts[0]) * 12 + Number(mParts[1]);
        let diff = Math.abs(idx - targetIdx);
        if (diff < minDiff) {
            minDiff = diff;
            bestMatch = {
                monthStr: mStr,
                units: Number(m['Units']),
                rev: Number(m['N. Revenue']),
                avgPrice: Number(m['N. Revenue']) / Number(m['Units'])
            };
        }
    });

    return bestMatch;
}

function renderProductVarianceEngine(data) {
    if (!data || data.length === 0) return;

    let dataA = [];
    let dataB = [];
    let lblA = "";
    let lblB = "";

    let compAEl = document.getElementById('productCompMonthA');
    let compBEl = document.getElementById('productCompMonthB');
    let startAEl = document.getElementById('productCompStartA');
    let endAEl = document.getElementById('productCompEndA');
    let startBEl = document.getElementById('productCompStartB');
    let endBEl = document.getElementById('productCompEndB');

    let availMonths = getAvailableMonths(data);
    let latestM = availMonths.length > 0 ? availMonths[0] : '2026-07';
    let latestY = latestM.split('-')[0];
    let prevY = String(Number(latestY) - 1);

    if (productCompRangeMode === 'range') {
        let startA = (startAEl && startAEl.value) || productCompStartA || `${latestY}-05`;
        let endA = (endAEl && endAEl.value) || productCompEndA || `${latestY}-08`;
        let startB = (startBEl && startBEl.value) || productCompStartB || `${prevY}-05`;
        let endB = (endBEl && endBEl.value) || productCompEndB || `${prevY}-08`;

        if (startAEl && !startAEl.value) startAEl.value = startA;
        if (endAEl && !endAEl.value) endAEl.value = endA;
        if (startBEl && !startBEl.value) startBEl.value = startB;
        if (endBEl && !endBEl.value) endBEl.value = endB;

        let monthsA = getMonthArrayBetween(startA, endA);
        let monthsB = getMonthArrayBetween(startB, endB);

        dataA = data.filter(d => monthsA.includes(d['Reporting Month']));
        dataB = data.filter(d => monthsB.includes(d['Reporting Month']));

        lblA = monthsA.length > 1 ? `${formatMonthLabel(startA)}–${formatMonthLabel(endA)}` : formatMonthLabel(startA);
        lblB = monthsB.length > 1 ? `${formatMonthLabel(startB)}–${formatMonthLabel(endB)}` : formatMonthLabel(startB);
    } else {
        let mA = (compAEl && compAEl.value) || productCompMonthA || latestM;
        let mB = (compBEl && compBEl.value) || productCompMonthB || getYoyMonth(mA);

        if (compAEl && !compAEl.value) compAEl.value = mA;
        if (compBEl && !compBEl.value) compBEl.value = mB;

        dataA = data.filter(d => d['Reporting Month'] === mA);
        dataB = data.filter(d => d['Reporting Month'] === mB);

        lblA = formatMonthLabel(mA);
        lblB = formatMonthLabel(mB);
    }

    const revA = dataA.reduce((sum, r) => sum + (Number(r['N. Revenue']) || 0), 0);
    const revB = dataB.reduce((sum, r) => sum + (Number(r['N. Revenue']) || 0), 0);
    const diffRev = revA - revB;
    const pctRev = revB > 0 ? ((revA - revB) / revB * 100) : (revA > 0 ? 100 : 0);

    // Headline Summary Cards
    setElementText('productCompLabelA', lblA + ' Rev (Ex VAT)');
    setElementText('productCompRevA', formatCurrency(revA));
    setElementText('productCompLabelB', lblB + ' Rev (Ex VAT)');
    setElementText('productCompRevB', formatCurrency(revB));

    const diffEl = document.getElementById('productCompVarianceDiff');
    const pctEl = document.getElementById('productCompVariancePct');
    const diffCard = document.getElementById('productCompVarianceCard');
    const pctCard = document.getElementById('productCompPctCard');

    if (diffEl) {
        diffEl.textContent = (diffRev >= 0 ? '+' : '') + formatCurrency(diffRev);
        diffEl.style.color = diffRev >= 0 ? '#009640' : '#DC2626';
    }
    if (pctEl) {
        pctEl.textContent = (pctRev >= 0 ? '+' : '') + pctRev.toFixed(1) + '%';
        pctEl.style.color = pctRev >= 0 ? '#009640' : '#DC2626';
    }
    if (diffCard) diffCard.style.borderLeftColor = diffRev >= 0 ? '#009640' : '#DC2626';
    if (pctCard) pctCard.style.borderLeftColor = pctRev >= 0 ? '#009640' : '#DC2626';

    // Header Month Labels in Tables
    setElementText('hdrDropA', lblA);
    setElementText('hdrDropB', lblB);
    setElementText('hdrGainA', lblA);
    setElementText('hdrGainB', lblB);
    setElementText('hdrTableA', lblA + ' Rev Ex VAT (Qty)');
    setElementText('hdrTableB', lblB + ' Rev Ex VAT (Qty)');

    // 1. Group by Product Key
    let productMap = new Map();

    dataA.forEach(r => {
        let key = getProductKey(r);
        let cats = getCategoryNames(r);
        let catName = cats.length > 0 ? cats[cats.length - 1] : 'Uncategorized';
        let catPrice = parseFloat(r['Catalog Price']) || 0;

        if (!productMap.has(key)) {
            productMap.set(key, {
                key: key,
                sku: getDisplaySku(r.SKU),
                name: r['Product title'] || 'Unknown',
                category: catName,
                categories: cats,
                catalogPrice: catPrice,
                revA: 0, unitsA: 0,
                revB: 0, unitsB: 0
            });
        }
        let p = productMap.get(key);
        p.revA += (Number(r['N. Revenue']) || 0);
        p.unitsA += (Number(r['Units']) || 0);
        if (!p.catalogPrice && catPrice) p.catalogPrice = catPrice;
    });

    dataB.forEach(r => {
        let key = getProductKey(r);
        let cats = getCategoryNames(r);
        let catName = cats.length > 0 ? cats[cats.length - 1] : 'Uncategorized';
        let catPrice = parseFloat(r['Catalog Price']) || 0;

        if (!productMap.has(key)) {
            productMap.set(key, {
                key: key,
                sku: getDisplaySku(r.SKU),
                name: r['Product title'] || 'Unknown',
                category: catName,
                categories: cats,
                catalogPrice: catPrice,
                revA: 0, unitsA: 0,
                revB: 0, unitsB: 0
            });
        }
        let p = productMap.get(key);
        p.revB += (Number(r['N. Revenue']) || 0);
        p.unitsB += (Number(r['Units']) || 0);
        if (!p.catalogPrice && catPrice) p.catalogPrice = catPrice;
    });

    let productsList = [];
    productMap.forEach(p => {
        p.diffRev = p.revA - p.revB;
        p.diffUnits = p.unitsA - p.unitsB;
        p.pct = p.revB > 0 ? ((p.revA - p.revB) / p.revB * 100) : (p.revA > 0 ? 100 : 0);

        // Smart Nearest Historical Sale Price Lookup
        let priceB = null;
        let priceBLabel = '';
        if (p.unitsB > 0) {
            priceB = p.revB / p.unitsB;
        } else {
            let nearestB = findNearestHistoricalSale(data, p.key, productCompRangeMode === 'range' ? productCompStartB : productCompMonthB);
            if (nearestB) {
                priceB = nearestB.avgPrice;
                priceBLabel = ` (${formatMonthLabel(nearestB.monthStr)})`;
            } else if (p.catalogPrice > 0) {
                priceB = p.catalogPrice;
                priceBLabel = ' (Cat.)';
            }
        }

        let priceA = null;
        let priceALabel = '';
        if (p.unitsA > 0) {
            priceA = p.revA / p.unitsA;
        } else {
            let nearestA = findNearestHistoricalSale(data, p.key, productCompRangeMode === 'range' ? productCompStartA : productCompMonthA);
            if (nearestA) {
                priceA = nearestA.avgPrice;
                priceALabel = ` (${formatMonthLabel(nearestA.monthStr)})`;
            } else if (p.catalogPrice > 0) {
                priceA = p.catalogPrice;
                priceALabel = ' (Cat.)';
            }
        }

        p.priceB = priceB;
        p.priceBLabel = priceBLabel;
        p.priceA = priceA;
        p.priceALabel = priceALabel;

        if (priceB !== null && priceA !== null && priceB > 0) {
            p.priceDiff = priceA - priceB;
            p.pricePct = ((priceA - priceB) / priceB) * 100;
        } else {
            p.priceDiff = null;
            p.pricePct = null;
        }

        p.unitsPct = p.unitsB > 0 ? ((p.unitsA - p.unitsB) / p.unitsB * 100) : (p.unitsA > 0 ? 100 : -100);

        productsList.push(p);
    });

    // 2. Group by Category (filtering out NULL and Uncategorized)
    let categoryMap = new Map();
    productsList.forEach(p => {
        p.categories.forEach(cat => {
            if (!cat || cat.trim() === '' || cat.toUpperCase() === 'NULL' || cat.toLowerCase() === 'uncategorized') return;
            if (!categoryMap.has(cat)) {
                categoryMap.set(cat, { catName: cat, revA: 0, revB: 0, diffRev: 0 });
            }
            let c = categoryMap.get(cat);
            c.revA += p.revA;
            c.revB += p.revB;
        });
    });

    let categoryList = [];
    categoryMap.forEach(c => {
        c.diffRev = c.revA - c.revB;
        categoryList.push(c);
    });

    // 3. Automated Executive Takeaway
    const takeawayEl = document.getElementById('productVarianceTakeawayText');
    if (takeawayEl) {
        let modeLabel = productCompRangeMode === 'range' ? 'Seasonal Range' : (productCompMode === 'yoy' ? 'YoY' : (productCompMode === 'mom' ? 'MoM' : 'Custom'));
        let absDiff = Math.abs(diffRev);
        let formattedAbsDiff = formatCurrency(absDiff);
        let formattedPct = Math.abs(pctRev).toFixed(1) + '%';

        let catDrops = [...categoryList].filter(c => c.diffRev < 0).sort((a, b) => a.diffRev - b.diffRev);
        let catGains = [...categoryList].filter(c => c.diffRev > 0).sort((a, b) => b.diffRev - a.diffRev);

        let prodDrops = [...productsList].filter(p => p.diffRev < 0).sort((a, b) => a.diffRev - b.diffRev);
        let prodGains = [...productsList].filter(p => p.diffRev > 0).sort((a, b) => b.diffRev - a.diffRev);

        if (diffRev < -100) {
            let topCatDrop = catDrops[0];
            let topProdDrop1 = prodDrops[0];
            let topProdDrop2 = prodDrops[1];

            let catDropPctText = topCatDrop && absDiff > 0 ? ` (${((Math.abs(topCatDrop.diffRev) / absDiff) * 100).toFixed(0)}% of total drop)` : '';
            let text = `<strong>${lblA}</strong> revenue fell by <strong>${formattedAbsDiff} (-${formattedPct})</strong> compared to <strong>${lblB}</strong> (${modeLabel}). `;
            if (topCatDrop) {
                text += `The largest category decline was in <strong>${topCatDrop.catName}</strong> (-${formatCurrency(Math.abs(topCatDrop.diffRev))})${catDropPctText}. `;
            }
            if (topProdDrop1) {
                text += `Top product drops were <strong>[${topProdDrop1.sku}] ${topProdDrop1.name}</strong> (-${formatCurrency(Math.abs(topProdDrop1.diffRev))})`;
                if (topProdDrop2) {
                    text += ` and <strong>[${topProdDrop2.sku}] ${topProdDrop2.name}</strong> (-${formatCurrency(Math.abs(topProdDrop2.diffRev))}).`;
                } else {
                    text += `.`;
                }
            }
            takeawayEl.innerHTML = text;
        } else if (diffRev > 100) {
            let topCatGain = catGains[0];
            let topProdGain1 = prodGains[0];
            let topProdGain2 = prodGains[1];

            let catGainPctText = topCatGain && absDiff > 0 ? ` (${((topCatGain.diffRev / absDiff) * 100).toFixed(0)}% of total growth)` : '';
            let text = `<strong>${lblA}</strong> revenue grew by <strong>+${formattedAbsDiff} (+${formattedPct})</strong> compared to <strong>${lblB}</strong> (${modeLabel}). `;
            if (topCatGain) {
                text += `Growth was driven primarily by <strong>${topCatGain.catName}</strong> (+${formatCurrency(topCatGain.diffRev)})${catGainPctText}. `;
            }
            if (topProdGain1) {
                text += `Top revenue gainers were <strong>[${topProdGain1.sku}] ${topProdGain1.name}</strong> (+${formatCurrency(topProdGain1.diffRev)})`;
                if (topProdGain2) {
                    text += ` and <strong>[${topProdGain2.sku}] ${topProdGain2.name}</strong> (+${formatCurrency(topProdGain2.diffRev)}).`;
                } else {
                    text += `.`;
                }
            }
            takeawayEl.innerHTML = text;
        } else {
            takeawayEl.innerHTML = `<strong>${lblA}</strong> revenue is stable compared to <strong>${lblB}</strong> (${modeLabel}), with a net change of <strong>${diffRev >= 0 ? '+' : ''}${formatCurrency(diffRev)} (${(pctRev >= 0 ? '+' : '') + pctRev.toFixed(1)}%)</strong>.`;
        }
    }

    // 4. Render Category Impact Breakdown List
    const catListEl = document.getElementById('productCategoryVarianceList');
    if (catListEl) {
        catListEl.innerHTML = '';
        let sortedCats = [...categoryList].sort((a, b) => Math.abs(b.diffRev) - Math.abs(a.diffRev)).slice(0, 7);
        if (sortedCats.length === 0) {
            catListEl.innerHTML = '<div style="color:#64748B; font-size:0.85rem; padding:0.5rem;">No category data available.</div>';
        } else {
            sortedCats.forEach(c => {
                let div = document.createElement('div');
                div.style.cssText = 'display:flex; justify-content:space-between; align-items:center; font-size:0.85rem; padding:0.35rem 0.6rem; background:#fff; border-radius:4px; border:1px solid #E2E8F0;';
                let sign = c.diffRev >= 0 ? '+' : '';
                let color = c.diffRev >= 0 ? '#009640' : '#DC2626';
                let bg = c.diffRev >= 0 ? '#DCFCE7' : '#FEE2E2';
                div.innerHTML = `
                    <span style="font-weight:600; color:#373737; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:180px;" title="${c.catName}">${c.catName}</span>
                    <span style="font-weight:700; color:${color}; background:${bg}; padding:0.15rem 0.4rem; border-radius:4px; font-size:0.8rem;">${sign}${formatCurrency(c.diffRev)}</span>
                `;
                catListEl.appendChild(div);
            });
        }
    }

    // 5. Populate Top Drops Table (£ Losers)
    const tbodyDrops = document.querySelector('#productTopDropsTable tbody');
    if (tbodyDrops) {
        tbodyDrops.innerHTML = '';
        let topDrops = [...productsList].filter(p => p.diffRev < 0).sort((a, b) => a.diffRev - b.diffRev).slice(0, 5);
        if (topDrops.length === 0) {
            tbodyDrops.innerHTML = '<tr><td colspan="7" style="text-align:center; color:#64748B; padding:1rem;">No revenue drops recorded.</td></tr>';
        } else {
            topDrops.forEach(p => {
                let tr = document.createElement('tr');
                tr.innerHTML = `
                    <td style="font-weight:600;">${p.sku}</td>
                    <td style="font-weight:500;">${p.name}</td>
                    <td style="color:#64748B; font-size:0.8rem;">${p.category}</td>
                    <td style="text-align:right;">${formatCurrency(p.revB)} <span style="color:#64748B; font-size:0.75rem;">(${p.unitsB})</span></td>
                    <td style="text-align:right;">${formatCurrency(p.revA)} <span style="color:#64748B; font-size:0.75rem;">(${p.unitsA})</span></td>
                    <td style="text-align:right; font-weight:700; color:#DC2626;">-${formatCurrency(Math.abs(p.diffRev))}</td>
                    <td style="text-align:right; font-weight:600; color:#DC2626;">${p.pct.toFixed(1)}%</td>
                `;
                tbodyDrops.appendChild(tr);
            });
        }
    }

    // 6. Populate Top Gains Table (£ Winners)
    const tbodyGains = document.querySelector('#productTopGainsTable tbody');
    if (tbodyGains) {
        tbodyGains.innerHTML = '';
        let topGains = [...productsList].filter(p => p.diffRev > 0).sort((a, b) => b.diffRev - a.diffRev).slice(0, 5);
        if (topGains.length === 0) {
            tbodyGains.innerHTML = '<tr><td colspan="7" style="text-align:center; color:#64748B; padding:1rem;">No revenue gains recorded.</td></tr>';
        } else {
            topGains.forEach(p => {
                let tr = document.createElement('tr');
                tr.innerHTML = `
                    <td style="font-weight:600;">${p.sku}</td>
                    <td style="font-weight:500;">${p.name}</td>
                    <td style="color:#64748B; font-size:0.8rem;">${p.category}</td>
                    <td style="text-align:right;">${formatCurrency(p.revB)} <span style="color:#64748B; font-size:0.75rem;">(${p.unitsB})</span></td>
                    <td style="text-align:right;">${formatCurrency(p.revA)} <span style="color:#64748B; font-size:0.75rem;">(${p.unitsA})</span></td>
                    <td style="text-align:right; font-weight:700; color:#009640;">+${formatCurrency(p.diffRev)}</td>
                    <td style="text-align:right; font-weight:600; color:#009640;">+${p.pct.toFixed(1)}%</td>
                `;
                tbodyGains.appendChild(tr);
            });
        }
    }

    // 7. Render Price Shift & Demand Sensitivity Alert Cards
    const sensitivityContainer = document.getElementById('productPriceSensitivityContainer');
    if (sensitivityContainer) {
        sensitivityContainer.innerHTML = '';

        let priceHikes = [...productsList]
            .filter(p => p.pricePct !== null && p.pricePct >= 3 && p.unitsPct <= -15 && p.unitsB > 0)
            .sort((a, b) => (b.pricePct * Math.abs(b.unitsPct)) - (a.pricePct * Math.abs(a.unitsPct)))
            .slice(0, 4);

        let priceCuts = [...productsList]
            .filter(p => p.pricePct !== null && p.pricePct <= -3 && p.unitsPct >= 15 && p.unitsB > 0)
            .sort((a, b) => (a.pricePct * b.unitsPct) - (b.pricePct * a.unitsPct))
            .slice(0, 4);

        if (priceHikes.length === 0 && priceCuts.length === 0) {
            sensitivityContainer.innerHTML = `
                <div style="grid-column: span 2; background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 1.25rem; text-align: center; color: #64748B; font-size: 0.88rem;">
                    No major price sensitivity anomalies detected between ${lblB} and ${lblA}.
                </div>
            `;
        } else {
            let hikeHtml = '';
            if (priceHikes.length > 0) {
                hikeHtml = `
                    <div style="background: #FFF5F5; border: 1px solid #FECDD3; border-radius: 8px; padding: 1rem; border-left: 4px solid #E11D48;">
                        <h4 style="font-weight: 700; color: #9F1239; font-size: 0.85rem; margin-bottom: 0.6rem; text-transform: uppercase; letter-spacing: 0.05em; display: flex; align-items: center; gap: 0.4rem;">
                            <span>⚠️</span> Price Increase → Volume Loss (${priceHikes.length})
                        </h4>
                        <div style="display: flex; flex-direction: column; gap: 0.6rem;">
                `;
                priceHikes.forEach(p => {
                    hikeHtml += `
                        <div style="background: white; border: 1px solid #FFE4E6; border-radius: 6px; padding: 0.5rem 0.75rem;">
                            <div style="font-weight: 600; font-size: 0.85rem; color: #1E293B;">[${p.sku}] ${p.name}</div>
                            <div style="font-size: 0.78rem; color: #64748B; margin-top: 0.2rem; display: flex; justify-content: space-between;">
                                <span>Unit Price: <strong style="color: #D97706;">${formatCurrency(p.priceB)} → ${formatCurrency(p.priceA)} (+${p.pricePct.toFixed(1)}%)</strong></span>
                                <span>Sales: <strong style="color: #DC2626;">${p.unitsB} → ${p.unitsA} units (${p.unitsPct.toFixed(1)}%)</strong></span>
                            </div>
                        </div>
                    `;
                });
                hikeHtml += `</div></div>`;
            } else {
                hikeHtml = `
                    <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 1rem; color: #64748B; font-size: 0.85rem;">
                        No major price hikes with volume drops recorded.
                    </div>
                `;
            }

            let cutHtml = '';
            if (priceCuts.length > 0) {
                cutHtml = `
                    <div style="background: #F0FDF4; border: 1px solid #BBF7D0; border-radius: 8px; padding: 1rem; border-left: 4px solid #16A34A;">
                        <h4 style="font-weight: 700; color: #166534; font-size: 0.85rem; margin-bottom: 0.6rem; text-transform: uppercase; letter-spacing: 0.05em; display: flex; align-items: center; gap: 0.4rem;">
                            <span>📈</span> Price Cut → Volume Growth (${priceCuts.length})
                        </h4>
                        <div style="display: flex; flex-direction: column; gap: 0.6rem;">
                `;
                priceCuts.forEach(p => {
                    cutHtml += `
                        <div style="background: white; border: 1px solid #DCFCE7; border-radius: 6px; padding: 0.5rem 0.75rem;">
                            <div style="font-weight: 600; font-size: 0.85rem; color: #1E293B;">[${p.sku}] ${p.name}</div>
                            <div style="font-size: 0.78rem; color: #64748B; margin-top: 0.2rem; display: flex; justify-content: space-between;">
                                <span>Unit Price: <strong style="color: #059669;">${formatCurrency(p.priceB)} → ${formatCurrency(p.priceA)} (${p.pricePct.toFixed(1)}%)</strong></span>
                                <span>Sales: <strong style="color: #009640;">${p.unitsB} → ${p.unitsA} units (+${p.unitsPct.toFixed(1)}%)</strong></span>
                            </div>
                        </div>
                    `;
                });
                cutHtml += `</div></div>`;
            } else {
                cutHtml = `
                    <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 1rem; color: #64748B; font-size: 0.85rem;">
                        No major price cuts with volume surges recorded.
                    </div>
                `;
            }

            sensitivityContainer.innerHTML = hikeHtml + cutHtml;
        }
    }

    // 8. Dynamic Category Filter in Main Table
    const catSelect = document.getElementById('productCompCategoryFilter');
    if (catSelect && !catSelect.dataset.populated) {
        let uniqueCats = new Set();
        data.forEach(d => {
            getCategoryNames(d).forEach(c => { if (c) uniqueCats.add(c); });
        });
        catSelect.innerHTML = '<option value="">All Categories</option>';
        Array.from(uniqueCats).sort().forEach(c => {
            let opt = document.createElement('option');
            opt.value = c;
            opt.textContent = c;
            catSelect.appendChild(opt);
        });
        catSelect.dataset.populated = "true";
    }

    // Attach Table Filter Input Handlers
    const compSearch = document.getElementById('productCompSearch');
    const compImpact = document.getElementById('productCompImpactFilter');
    const retriggerTable = () => renderProductCompTable(productsList, diffRev);

    if (compSearch && !compSearch.dataset.bound) {
        compSearch.oninput = retriggerTable;
        if (catSelect) catSelect.onchange = retriggerTable;
        if (compImpact) compImpact.onchange = retriggerTable;
        compSearch.dataset.bound = "true";
    }

    // Sort Table Headers Binding
    const bindSortHeader = (id, colName) => {
        const el = document.getElementById(id);
        if (el && !el.dataset.bound) {
            el.onclick = () => {
                if (productCompSortCol === colName) {
                    productCompSortDir = productCompSortDir === 'asc' ? 'desc' : 'asc';
                } else {
                    productCompSortCol = colName;
                    productCompSortDir = (colName === 'sku' || colName === 'name') ? 'asc' : 'asc';
                }
                updateCompSortHeaderSymbols();
                renderProductCompTable(productsList, diffRev);
            };
            el.dataset.bound = "true";
        }
    };
    bindSortHeader('productCompSortSku', 'sku');
    bindSortHeader('productCompSortName', 'name');
    bindSortHeader('productCompSortPriceShift', 'pricePct');
    bindSortHeader('productCompSortVolumeShift', 'unitsPct');
    bindSortHeader('productCompSortDiff', 'diffRev');
    bindSortHeader('productCompSortPct', 'pct');

    const updateCompSortHeaderSymbols = () => {
        const cols = { sku: 'productCompSortSku', name: 'productCompSortName', pricePct: 'productCompSortPriceShift', unitsPct: 'productCompSortVolumeShift', diffRev: 'productCompSortDiff', pct: 'productCompSortPct' };
        for (const [col, id] of Object.entries(cols)) {
            const el = document.getElementById(id);
            if (el) {
                let base = el.textContent.split(' ')[0];
                if (productCompSortCol === col) {
                    el.textContent = base + (productCompSortDir === 'asc' ? ' ▲' : ' ▼');
                } else {
                    el.textContent = base + ' ↕';
                }
            }
        }
    };

    renderProductCompTable(productsList, diffRev);
}

function renderProductCompTable(productsList, totalNetDiff) {
    const tbody = document.querySelector('#productCompTable tbody');
    if (!tbody) return;

    const compSearch = document.getElementById('productCompSearch');
    const catSelect = document.getElementById('productCompCategoryFilter');
    const compImpact = document.getElementById('productCompImpactFilter');

    let filterText = compSearch ? compSearch.value.toLowerCase().trim() : '';
    let filterCat = catSelect ? catSelect.value : '';
    let filterImpact = compImpact ? compImpact.value : '';

    let filtered = productsList.filter(p => {
        if (filterText && !p.sku.toLowerCase().includes(filterText) && !p.name.toLowerCase().includes(filterText)) {
            return false;
        }
        if (filterCat && !p.categories.includes(filterCat)) {
            return false;
        }
        if (filterImpact === 'drops' && p.diffRev >= 0) return false;
        if (filterImpact === 'gains' && p.diffRev <= 0) return false;
        if (filterImpact === 'priceHikes' && (p.pricePct === null || p.pricePct <= 0)) return false;
        return true;
    });

    // Safe Sort
    filtered.sort((a, b) => {
        let valA = a[productCompSortCol];
        let valB = b[productCompSortCol];

        if (valA === null || valA === undefined) valA = productCompSortDir === 'asc' ? Infinity : -Infinity;
        if (valB === null || valB === undefined) valB = productCompSortDir === 'asc' ? Infinity : -Infinity;

        if (typeof valA === 'string' || typeof valB === 'string') {
            let strA = String(valA || '');
            let strB = String(valB || '');
            return productCompSortDir === 'asc' ? strA.localeCompare(strB) : strB.localeCompare(strA);
        } else {
            return productCompSortDir === 'asc' ? valA - valB : valB - valA;
        }
    });

    window.lastFilteredProductCompList = filtered;

    tbody.innerHTML = '';
    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" style="text-align:center; color:#64748B; padding:2rem;">No products match current filters.</td></tr>';
        return;
    }

    filtered.forEach((p, idx) => {
        let tr = document.createElement('tr');
        let diffColor = p.diffRev > 0 ? '#009640' : p.diffRev < 0 ? '#DC2626' : '#475569';
        let diffSign = p.diffRev > 0 ? '+' : '';
        let pctSign = p.pct > 0 ? '+' : '';

        let priceStr = 'N/A';
        if (p.priceB !== null && p.priceA !== null) {
            let pBStr = formatCurrency(p.priceB) + (p.unitsB === 0 ? `<span style="font-size:0.72rem; color:#64748B;">${p.priceBLabel}</span>` : '');
            let pAStr = formatCurrency(p.priceA) + (p.unitsA === 0 ? `<span style="font-size:0.72rem; color:#64748B;">${p.priceALabel}</span>` : '');
            priceStr = `${pBStr} → ${pAStr}`;
            
            if (p.pricePct !== null) {
                let priceSign = p.pricePct > 0 ? '+' : '';
                let priceStyle = p.pricePct > 0 ? 'color:#D97706;' : p.pricePct < 0 ? 'color:#059669;' : 'color:#64748B;';
                priceStr += ` <span style="${priceStyle}">(${priceSign}${p.pricePct.toFixed(1)}%)</span>`;
            }
        } else if (p.priceA !== null) {
            let pAStr = formatCurrency(p.priceA) + (p.unitsA === 0 ? `<span style="font-size:0.72rem; color:#64748B;">${p.priceALabel}</span>` : '');
            priceStr = `N/A → ${pAStr}`;
        } else if (p.priceB !== null) {
            let pBStr = formatCurrency(p.priceB) + (p.unitsB === 0 ? `<span style="font-size:0.72rem; color:#64748B;">${p.priceBLabel}</span>` : '');
            priceStr = `${pBStr} → N/A`;
        }

        let volumeStr = `${p.unitsB} → ${p.unitsA}`;
        let volumeSign = p.unitsPct > 0 ? '+' : '';
        let volumeStyle = p.unitsPct > 0 ? 'color:#009640; font-weight:600;' : p.unitsPct < 0 ? 'color:#DC2626; font-weight:600;' : 'color:#64748B;';

        tr.innerHTML = `
            <td style="text-align:center; color:#64748B;">${idx + 1}</td>
            <td style="font-weight:600;">${p.sku}</td>
            <td style="font-weight:500;">${p.name}</td>
            <td style="color:#64748B; font-size:0.85rem;">${p.category}</td>
            <td style="text-align:right;">${formatCurrency(p.revB)} <span style="color:#64748B; font-size:0.75rem;">(${p.unitsB})</span></td>
            <td style="text-align:right;">${formatCurrency(p.revA)} <span style="color:#64748B; font-size:0.75rem;">(${p.unitsA})</span></td>
            <td style="text-align:right; font-size:0.85rem;">${priceStr}</td>
            <td style="text-align:right; font-size:0.85rem;">${volumeStr} <span style="${volumeStyle}">(${volumeSign}${p.unitsPct.toFixed(1)}%)</span></td>
            <td style="text-align:right; font-weight:700; color:${diffColor};">${diffSign}${formatCurrency(p.diffRev)}</td>
            <td style="text-align:right; font-weight:600; color:${diffColor};">${pctSign}${p.pct.toFixed(1)}%</td>
        `;
        tbody.appendChild(tr);
    });
}

function exportProductComparisonCsv() {
    if (!window.lastFilteredProductCompList || window.lastFilteredProductCompList.length === 0) {
        alert("No comparison product data to export based on current filters.");
        return;
    }

    const mA = productCompMonthA;
    const mB = productCompMonthB;
    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += `SKU,Product Name,Category,${formatMonthLabel(mB)} Revenue,${formatMonthLabel(mB)} Units,${formatMonthLabel(mB)} Unit Price,${formatMonthLabel(mA)} Revenue,${formatMonthLabel(mA)} Units,${formatMonthLabel(mA)} Unit Price,Price Shift %,Volume Shift %,Net Variance (£),% Rev Change\n`;

    window.lastFilteredProductCompList.forEach(p => {
        let name = p.name ? p.name.replace(/"/g, '""') : '';
        let cat = p.category ? p.category.replace(/"/g, '""') : '';
        csvContent += `"${p.sku}","${name}","${cat}",${p.revB.toFixed(2)},${p.unitsB},${p.priceB.toFixed(2)},${p.revA.toFixed(2)},${p.unitsA},${p.priceA.toFixed(2)},${p.pricePct.toFixed(2)},${p.unitsPct.toFixed(2)},${p.diffRev.toFixed(2)},${p.pct.toFixed(2)}\n`;
    });

    let encodedUri = encodeURI(csvContent);
    let link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `product_variance_${mA}_vs_${mB}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function updateCategoryDashboard() {
    const data = appData.product;
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
    
    let pluginsConfig = { 
        datalabels: { 
            display: function(ctx) { return ctx.dataIndex % 2 === 0 && ctx.dataset.data[ctx.dataIndex] > 0; },
            formatter: (v) => Math.round(v).toLocaleString() 
        } 
    };
    
    const annotationConfig = getChartAnnotationsConfigs(labels);
    if (annotationConfig.annotation) {
        pluginsConfig.annotation = annotationConfig.annotation;
    }
    
    window[canvasId] = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: { labels: labels, datasets: [{
            label: dataObj.label, data: dataObj.data,
            borderColor: dataObj.color || '#009640', backgroundColor: 'rgba(0,150,64,0.1)',
            fill: true, tension: 0.3, borderWidth: 2, pointBackgroundColor: dataObj.color || '#009640'
        }] },
        options: { 
            responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } },
            plugins: pluginsConfig 
        }
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
    
    let pluginsConfig = { datalabels: { display: false } };
    const annotationConfig = getChartAnnotationsConfigs(labels);
    if (annotationConfig.annotation) {
        pluginsConfig.annotation = annotationConfig.annotation;
    }
    
    let opts = { responsive: true, maintainAspectRatio: false,
        scales: { y: { beginAtZero: true, position: 'left' } },
        plugins: pluginsConfig 
    };
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
    // 1. Product Pairings
    const basketData = appData.basket ? normalizeBasketRows(appData.basket) : [];
    const filterInput = document.getElementById('basketFilter');
    const tbody = document.querySelector('#basketTable tbody');
    if (tbody) {
        const renderTable = () => {
            let term = filterInput ? filterInput.value.toLowerCase() : "";
            let filtered = basketData;
            if (term) {
                filtered = basketData.filter(d => 
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
    }

    // 2. Project vs Maintenance
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

    // 3. Cross-Category
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

    // 4. Consumables Table
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

    // 5. AOV Multipliers
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

    // 6. Average Basket Value Over Time with Category Dropdown Filter
    let selectEl = document.getElementById('basketAovCategorySelect');
    let noticeEl = document.getElementById('basketAovNotice');

    // Build category list for the dropdown
    let categories = new Set();
    if (appData.product) {
        appData.product.forEach(row => {
            getCategoryNames(row).forEach(c => categories.add(c));
        });
    }
    if (appData.categoryHierarchy) {
        appData.categoryHierarchy.forEach(row => {
            if (row['Category Name']) categories.add(row['Category Name']);
            if (row['Parent Name']) categories.add(row['Parent Name']);
        });
    }

    if (selectEl) {
        let currentSel = selectEl.value;
        selectEl.innerHTML = '<option value="">All Categories</option>';
        Array.from(categories).sort().forEach(cat => {
            let opt = document.createElement('option');
            opt.value = cat;
            opt.textContent = cat;
            selectEl.appendChild(opt);
        });
        if (currentSel && categories.has(currentSel)) {
            selectEl.value = currentSel;
        }
    }

    // Show/hide missing basketAnchors dataset warning banner
    if (noticeEl) {
        if (!appData.basketAnchors || appData.basketAnchors.length === 0) {
            noticeEl.textContent = "⚠️ Upload 'Top AOV Multipliers (High-Value Anchors)' CSV to enable category breakdown filtering.";
            noticeEl.style.display = "block";
        } else {
            noticeEl.style.display = "none";
        }
    }

    // Build category lookup mapping for products
    let productToCategories = {};
    if (appData.product) {
        appData.product.forEach(row => {
            let title = row['Product title'];
            if (title && row.Category) {
                if (!productToCategories[title]) {
                    productToCategories[title] = new Set();
                }
                getCategoryNames(row).forEach(c => productToCategories[title].add(c));
            }
        });
    }
    if (appData.basketConsumables) {
        appData.basketConsumables.forEach(row => {
            let title = row['Product Name'];
            if (title && row.Category) {
                if (!productToCategories[title]) {
                    productToCategories[title] = new Set();
                }
                getCategoryNames(row).forEach(c => productToCategories[title].add(c));
            }
        });
    }

    const renderBasketAovTrend = () => {
        const selectedCategory = selectEl ? selectEl.value : "";
        const months = getMonthsInRange();
        
        let aovData = months.map(m => {
            if (!selectedCategory) {
                // All Categories (Overall Store AOV)
                if (appData.executive && appData.executive.length > 0) {
                    let execRow = appData.executive.find(d => d['Reporting Month'] === m);
                    if (execRow && execRow.average_order_value !== undefined) {
                        return execRow.average_order_value;
                    }
                }
                if (appData.basketProject && appData.basketProject.length > 0) {
                    let monthRows = appData.basketProject.filter(d => d['Reporting Month'] === m);
                    if (monthRows.length > 0) {
                        let totalRev = monthRows.reduce((sum, r) => sum + (r['Total Revenue'] || 0), 0);
                        let totalBaskets = monthRows.reduce((sum, r) => sum + (r['Total Baskets'] || 0), 0);
                        if (totalBaskets > 0) return totalRev / totalBaskets;
                    }
                }
                if (appData.basketAnchors && appData.basketAnchors.length > 0) {
                    let monthRows = appData.basketAnchors.filter(d => d['Reporting Month'] === m);
                    if (monthRows.length > 0) {
                        let totalRev = monthRows.reduce((sum, r) => sum + (r['Total Basket Revenue'] || 0), 0);
                        let totalOrders = monthRows.reduce((sum, r) => sum + (r['Total Orders Containing Item'] || 0), 0);
                        if (totalOrders > 0) return totalRev / totalOrders;
                    }
                }
                return 0;
            } else {
                // Filtered by Selected Category
                if (appData.basketAnchors && appData.basketAnchors.length > 0) {
                    let monthRows = appData.basketAnchors.filter(d => d['Reporting Month'] === m);
                    let totalRev = 0;
                    let totalOrders = 0;
                    monthRows.forEach(d => {
                        let cats = [];
                        if (d.Category) {
                            cats = getCategoryNames(d);
                        } else {
                            let name = d['Product Name'];
                            if (name && productToCategories[name]) {
                                cats = Array.from(productToCategories[name]);
                            }
                        }
                        if (cats.includes(selectedCategory)) {
                            totalRev += (d['Total Basket Revenue'] || 0);
                            totalOrders += (d['Total Orders Containing Item'] || 0);
                        }
                    });
                    return totalOrders > 0 ? (totalRev / totalOrders) : 0;
                }
                return 0;
            }
        });
        
        let label = selectedCategory ? `Avg Basket Value: ${selectedCategory} (£)` : 'Overall Average Basket Value (£)';
        renderLineChart('basketAovTrendChart', months.map(formatMonthLabel), {
            label: label,
            data: aovData.map(v => Math.round(v)),
            color: '#8B5CF6' // Premium violet/purple color for basket analysis
        });
    };

    if (selectEl && !selectEl.dataset.listenerAttached) {
        selectEl.addEventListener('change', renderBasketAovTrend);
        selectEl.dataset.listenerAttached = "true";
    }

    renderBasketAovTrend();
}


function renderRisingFallingStars(type, month, prevMonth, data, risingTableId, fallingTableId) {
    const risingTbody = document.querySelector('#' + risingTableId + ' tbody');
    const fallingTbody = document.querySelector('#' + fallingTableId + ' tbody');
    if (!risingTbody || !fallingTbody) return;

    let stats = {};
    
    if (type === 'product') {
        data.filter(d => d['Reporting Month'] === month).forEach(d => {
            let key = getProductKey(d);
            let displaySku = getDisplaySku(d.SKU);
            if (!stats[key]) stats[key] = { name: d['Product title'] || 'Unknown', curRev: 0, prevRev: 0, sku: displaySku };
            stats[key].curRev += (d['N. Revenue'] || 0);
        });
        data.filter(d => d['Reporting Month'] === prevMonth).forEach(d => {
            let key = getProductKey(d);
            let displaySku = getDisplaySku(d.SKU);
            if (!stats[key]) stats[key] = { name: d['Product title'] || 'Unknown', curRev: 0, prevRev: 0, sku: displaySku };
            stats[key].prevRev += (d['N. Revenue'] || 0);
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

// ===== PRODUCT SALES OPTIMISER TAB SECTION =====
let productSalesSortCol = "revenue"; 
let productSalesSortDir = "desc";    

function getProductSegment(product, totalStoreRevenue, months) {
    let totalRev = product.totalRev;
    let totalUnits = product.totalUnits;
    let avgPrice = totalUnits > 0 ? (totalRev / totalUnits) : 0;
    let revShare = totalStoreRevenue > 0 ? (totalRev / totalStoreRevenue * 100) : 0;

    // 1. Identify Sliding Trend Windows
    let N = months.length;
    let recentMonths = [];
    let olderMonths = [];

    if (N >= 6) {
        recentMonths = months.slice(N - 3);
        olderMonths = months.slice(N - 6, N - 3);
    } else if (N >= 2) {
        let half = Math.floor(N / 2);
        recentMonths = months.slice(N - half);
        olderMonths = months.slice(0, N - half);
    } else {
        recentMonths = months;
        olderMonths = [];
    }

    // 2. Sum sales in windows
    let recentRev = product.rows.filter(r => recentMonths.includes(r['Reporting Month'])).reduce((sum, r) => sum + (Number(r['N. Revenue']) || 0), 0);
    let recentUnits = product.rows.filter(r => recentMonths.includes(r['Reporting Month'])).reduce((sum, r) => sum + (Number(r['Units']) || 0), 0);
    let olderRev = product.rows.filter(r => olderMonths.includes(r['Reporting Month'])).reduce((sum, r) => sum + (Number(r['N. Revenue']) || 0), 0);

    let recentAvg = recentMonths.length > 0 ? (recentRev / recentMonths.length) : 0;
    let olderAvg = olderMonths.length > 0 ? (olderRev / olderMonths.length) : 0;

    // 3. Dormant check (no sales at all in last 3 months of selected range)
    let isDormant = (N >= 3 && recentUnits === 0);

    // 4. YoY Seasonality check
    let isSeasonalDip = false;
    let yoyChange = 0;
    let hasYoYData = false;

    const getSameMonthLastYear = (ym) => {
        let parts = ym.split('-');
        return (parseInt(parts[0]) - 1) + '-' + parts[1];
    };

    let pctChange = 0;
    if (olderAvg > 0 && !isDormant) {
        pctChange = ((recentAvg - olderAvg) / olderAvg) * 100;
        if (pctChange < -10) {
            let yoyMonths = recentMonths.map(getSameMonthLastYear);
            let dbData = appData.product;
            let sampleRow = dbData.find(d => yoyMonths.includes(d['Reporting Month']));
            if (sampleRow) {
                hasYoYData = true;
                let yoyRev = product.rows.filter(r => yoyMonths.includes(r['Reporting Month'])).reduce((sum, r) => sum + (Number(r['N. Revenue']) || 0), 0);
                if (yoyRev > 0) {
                    yoyChange = ((recentRev - yoyRev) / yoyRev) * 100;
                    if (yoyChange >= -5) {
                        isSeasonalDip = true;
                    }
                }
            }
        }
    }

    // 5. Determine Trend Text and Color
    let trendText = "";
    let trendColor = "#373737";

    if (isDormant) {
        trendText = "💤 Dormant (No recent sales in last 3M)";
        trendColor = "#94A3B8";
    } else if (olderAvg > 0) {
        if (isSeasonalDip) {
            trendText = `🍂 Seasonal Dip (YoY stable/growing ${yoyChange >= 0 ? '+' : ''}${Math.round(yoyChange)}%)`;
            trendColor = "#D97706";
        } else if (pctChange > 10) {
            trendText = `📈 Growing (+${Math.round(pctChange)}%)`;
            trendColor = "#009640";
        } else if (pctChange < -10) {
            trendText = `📉 Declining (${Math.round(pctChange)}% MoM${hasYoYData ? `, YoY ${Math.round(yoyChange)}%` : ''})`;
            trendColor = "#EF4444";
        } else {
            trendText = `➡️ Stable (+/- 10% variation)`;
            trendColor = "#475569";
        }
    } else {
        if (recentAvg > 0) {
            trendText = `✨ Emerging (New product / launch)`;
            trendColor = "#3B82F6";
        } else {
            trendText = `Stable (No sales)`;
            trendColor = "#64748B";
        }
    }

    // 6. Determine Priority Segment Key
    let segmentKey = "standard";
    let segmentTitle = "Standard Optimization";
    let segmentBadge = `<span style="background: #F1F5F9; color: #475569; padding: 0.25rem 0.6rem; border-radius: 4px; font-weight: 600; font-size: 0.85rem; border: 1px solid #E2E8F0;">Standard Priority</span>`;

    if (revShare >= 1.0) {
        segmentKey = "seo";
        segmentTitle = "High-Impact Revenue Driver";
        segmentBadge = `<span style="background: #FEF3C7; color: #D97706; padding: 0.25rem 0.6rem; border-radius: 4px; font-weight: 600; font-size: 0.85rem; border: 1px solid #FDE68A;">🔥 High SEO Priority</span>`;
    } else if (avgPrice < 25 && totalUnits >= 15) {
        segmentKey = "cross";
        segmentTitle = "High-Volume Catalog Driver";
        segmentBadge = `<span style="background: #E0F2FE; color: #0369A1; padding: 0.25rem 0.6rem; border-radius: 4px; font-weight: 600; font-size: 0.85rem; border: 1px solid #BAE6FD;">🛒 Cross-Sell Focus</span>`;
    } else if (isDormant) {
        segmentKey = "standard";
        segmentTitle = "Dormant Product";
        segmentBadge = `<span style="background: #F1F5F9; color: #64748B; padding: 0.25rem 0.6rem; border-radius: 4px; font-weight: 600; font-size: 0.85rem; border: 1px solid #CBD5E1;">💤 Dormant</span>`;
    } else if (isSeasonalDip) {
        segmentKey = "standard";
        segmentTitle = "Seasonal Maintenance";
        segmentBadge = `<span style="background: #FFF3C4; color: #D97706; padding: 0.25rem 0.6rem; border-radius: 4px; font-weight: 600; font-size: 0.85rem; border: 1px solid #FDE68A;">🍂 Seasonal Dip</span>`;
    } else if (pctChange < -10) {
        segmentKey = "declining";
        segmentTitle = "Declining Sales Recovery";
        segmentBadge = `<span style="background: #FEE2E2; color: #991B1B; padding: 0.25rem 0.6rem; border-radius: 4px; font-weight: 600; font-size: 0.85rem; border: 1px solid #FCA5A5;">⚠️ Underperforming</span>`;
    } else if (pctChange > 10) {
        segmentKey = "rising";
        segmentTitle = "Rising Momentum Product";
        segmentBadge = `<span style="background: #DCFCE7; color: #166534; padding: 0.25rem 0.6rem; border-radius: 4px; font-weight: 600; font-size: 0.85rem; border: 1px solid #BBF7D0;">📈 Rising Star</span>`;
    }

    return {
        segmentKey,
        segmentTitle,
        segmentBadge,
        avgPrice,
        revShare,
        trendText,
        trendColor,
        pctChange,
        isDormant,
        isSeasonalDip,
        yoyChange,
        hasYoYData
    };
}

function updateProductSalesDashboard() {
    const data = appData.product;
    if (!data || data.length === 0) return;

    const months = getMonthsInRange();

    // 1. Inputs
    const searchInput = document.getElementById('productSalesSearch');
    const categorySelect = document.getElementById('productSalesCategoryFilter');
    const segmentSelect = document.getElementById('productSalesSegmentFilter');
    const minRevInput = document.getElementById('productSalesMinRev');
    const minUnitsInput = document.getElementById('productSalesMinUnits');
    const resetBtn = document.getElementById('productSalesResetFilters');

    if (!searchInput || !categorySelect || !segmentSelect) return;

    // Get all unique categories for the dropdown filter (only run once)
    if (!categorySelect.dataset.populated) {
        let uniqueCats = new Set();
        data.forEach(d => {
            getCategoryNames(d).forEach(cat => {
                if (cat) uniqueCats.add(cat);
            });
        });
        
        categorySelect.innerHTML = '<option value="">All Categories</option>';
        Array.from(uniqueCats).sort().forEach(cat => {
            let opt = document.createElement('option');
            opt.value = cat;
            opt.textContent = cat;
            categorySelect.appendChild(opt);
        });
        categorySelect.dataset.populated = "true";
    }

    // Reset filters handler
    if (resetBtn && !resetBtn.dataset.bound) {
        resetBtn.onclick = () => {
            searchInput.value = "";
            categorySelect.value = "";
            segmentSelect.value = "";
            minRevInput.value = "";
            minUnitsInput.value = "";
            updateProductSalesDashboard();
        };
        resetBtn.dataset.bound = "true";
    }

    // Input handlers
    const retrigger = () => {
        updateProductSalesDashboard();
    };
    if (!searchInput.dataset.bound) {
        searchInput.oninput = retrigger;
        categorySelect.onchange = retrigger;
        segmentSelect.onchange = retrigger;
        minRevInput.oninput = retrigger;
        minUnitsInput.oninput = retrigger;
        searchInput.dataset.bound = "true";
    }

    // 2. Compute Total Catalog Revenue (for share calculation)
    let totalStoreRevenue = 0;
    data.forEach(d => {
        if (!months.includes(d['Reporting Month'])) return;
        totalStoreRevenue += (Number(d['N. Revenue']) || 0);
    });

    // 3. Aggregate Data
    let productStats = new Map(); // Key -> { sku, key, name, category, totalUnits: 0, totalRev: 0, rows: [] }

    data.forEach(d => {
        if (!months.includes(d['Reporting Month'])) return;
        
        let rev = Number(d['N. Revenue']) || 0;
        let units = Number(d['Units']) || 0;

        let key = getProductKey(d);
        if (!productStats.has(key)) {
            let cats = getCategoryNames(d);
            let categoryName = cats.length > 0 ? cats[cats.length - 1] : "Uncategorized";
            productStats.set(key, {
                sku: getDisplaySku(d.SKU),
                key: key,
                name: d['Product title'] || 'Unknown',
                category: categoryName,
                categories: cats,
                totalUnits: 0,
                totalRev: 0,
                rows: []
            });
        }
        let p = productStats.get(key);
        p.totalUnits += units;
        p.totalRev += rev;
        p.rows.push(d);
    });

    // Compute segment for each product
    productStats.forEach(p => {
        p.segment = getProductSegment(p, totalStoreRevenue, months);
    });

    // 4. Filter aggregated products
    let filterKeyword = searchInput.value.toLowerCase().trim();
    let filterCategory = categorySelect.value;
    let filterSegment = segmentSelect.value;
    let minRev = parseFloat(minRevInput.value) || 0;
    let minUnits = parseFloat(minUnitsInput.value) || 0;

    let filteredProducts = [];
    productStats.forEach(p => {
        if (filterKeyword && !p.key.toLowerCase().includes(filterKeyword) && !p.name.toLowerCase().includes(filterKeyword)) {
            return;
        }
        if (filterCategory && !p.categories.includes(filterCategory)) {
            return;
        }
        if (filterSegment && p.segment.segmentKey !== filterSegment) {
            return;
        }
        if (p.totalRev < minRev) return;
        if (p.totalUnits < minUnits) return;

        filteredProducts.push(p);
    });

    // 5. Sort products
    filteredProducts.sort((a, b) => {
        let valA, valB;
        if (productSalesSortCol === 'sku') {
            valA = a.sku; valB = b.sku;
        } else if (productSalesSortCol === 'name') {
            valA = a.name; valB = b.name;
        } else if (productSalesSortCol === 'units') {
            valA = a.totalUnits; valB = b.totalUnits;
        } else {
            valA = a.totalRev; valB = b.totalRev;
        }

        if (typeof valA === 'string') {
            return productSalesSortDir === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        } else {
            return productSalesSortDir === 'asc' ? valA - valB : valB - valA;
        }
    });

    window.lastFilteredSalesProducts = filteredProducts;

    // 6. Select default product if none selected or if selected is not in filtered list
    if (!selectedProductSalesSku || !productStats.has(selectedProductSalesSku)) {
        if (filteredProducts.length > 0) {
            selectedProductSalesSku = filteredProducts[0].key;
        } else {
            selectedProductSalesSku = "";
        }
    }

    // 7. Bind sort headers click events
    const bindSort = (id, colName) => {
        const el = document.getElementById(id);
        if (el && !el.dataset.bound) {
            el.onclick = () => {
                if (productSalesSortCol === colName) {
                    productSalesSortDir = productSalesSortDir === 'asc' ? 'desc' : 'asc';
                } else {
                    productSalesSortCol = colName;
                    productSalesSortDir = 'desc';
                }
                updateSortHeaderSymbols();
                updateProductSalesDashboard();
            };
            el.dataset.bound = "true";
        }
    };
    bindSort('productSalesSortSku', 'sku');
    bindSort('productSalesSortName', 'name');
    bindSort('productSalesSortUnits', 'units');
    bindSort('productSalesSortRev', 'revenue');

    const updateSortHeaderSymbols = () => {
        const cols = { sku: 'productSalesSortSku', name: 'productSalesSortName', units: 'productSalesSortUnits', revenue: 'productSalesSortRev' };
        for (const [col, id] of Object.entries(cols)) {
            const el = document.getElementById(id);
            if (el) {
                let base = el.textContent.split(' ')[0];
                if (productSalesSortCol === col) {
                    el.textContent = base + (productSalesSortDir === 'asc' ? ' ▲' : ' ▼');
                } else {
                    el.textContent = base + ' ↕';
                }
            }
        }
    };

    // 8. Render Table
    const tbody = document.querySelector('#productSalesTable tbody');
    if (tbody) {
        tbody.innerHTML = '';
        if (filteredProducts.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color:#64748B; padding:2rem;">No products match current filters.</td></tr>';
        } else {
            filteredProducts.forEach((p, idx) => {
                let tr = document.createElement('tr');
                tr.style.cursor = 'pointer';
                if (p.key === selectedProductSalesSku) {
                    tr.classList.add('active-row');
                }

                let avgPrice = p.totalUnits > 0 ? (p.totalRev / p.totalUnits) : 0;
                let share = totalStoreRevenue > 0 ? ((p.totalRev * 100) / totalStoreRevenue).toFixed(2) + '%' : '0%';

                tr.innerHTML = `
                    <td style="text-align: center; color: #64748B;">${idx + 1}</td>
                    <td style="font-weight: 600;">${p.sku}</td>
                    <td style="font-weight: 500;">${p.name}</td>
                    <td style="color: #64748B; font-size: 0.85rem;">${p.category}</td>
                    <td style="text-align: center; font-weight: 600;">${formatWholeNumber(p.totalUnits)}</td>
                    <td style="text-align: right; font-weight: 600; color: #009640;">${formatCurrency(p.totalRev)}</td>
                    <td style="text-align: right; color: #475569;">${formatCurrency(avgPrice)}</td>
                    <td style="text-align: right; color: #475569; font-weight: 500;">${share}</td>
                `;

                tr.onclick = () => {
                    selectedProductSalesSku = p.key;
                    const toggleSalesRev = document.getElementById('toggleSalesRev');
                    const toggleSalesUnits = document.getElementById('toggleSalesUnits');
                    if (toggleSalesRev) toggleSalesRev.checked = true;
                    if (toggleSalesUnits) toggleSalesUnits.checked = true;
                    updateProductSalesDashboard();
                };

                tbody.appendChild(tr);
            });
        }
    }

    // 9. Render trend chart for selected product
    if (selectedProductSalesSku && productStats.has(selectedProductSalesSku)) {
        const selectedProduct = productStats.get(selectedProductSalesSku);
        renderProductSalesTrendChart(selectedProduct);
        renderProductSalesOptimiser(selectedProduct);
    } else {
        if (window.productSalesTrendChart instanceof Chart) {
            window.productSalesTrendChart.destroy();
        }
        const optContent = document.getElementById('productSalesOptimiserContent');
        if (optContent) {
            optContent.innerHTML = '<div style="color: #64748B; text-align: center; padding: 2rem;">No product selected.</div>';
        }
        const titleEl = document.getElementById('productSalesTrendTitle');
        if (titleEl) titleEl.textContent = 'Product Sales Trend';
    }
}

function renderProductSalesTrendChart(product) {
    const titleEl = document.getElementById('productSalesTrendTitle');
    if (titleEl) {
        titleEl.textContent = `Trend: [${product.sku}] ${product.name}`;
    }

    const months = getMonthsInRange();
    
    let revData = [];
    let unitsData = [];

    months.forEach(m => {
        let match = product.rows.find(r => r['Reporting Month'] === m);
        if (match) {
            revData.push(Number(match['N. Revenue']) || 0);
            unitsData.push(Number(match['Units']) || 0);
        } else {
            revData.push(0);
            unitsData.push(0);
        }
    });

    renderMultiLineChart('productSalesTrendChart', months.map(formatMonthLabel), [
        { label: 'Net Revenue (£)', data: revData, color: '#009640', yAxisID: 'y' },
        { label: 'Units Sold', data: unitsData, color: '#8B5CF6', yAxisID: 'y1' }
    ]);
}

function toggleProductSalesDataset(datasetIndex, visible) {
    if (window.productSalesTrendChart instanceof Chart) {
        window.productSalesTrendChart.setDatasetVisibility(datasetIndex, visible);
        window.productSalesTrendChart.update();
    }
}

function renderProductSalesOptimiser(product) {
    const container = document.getElementById('productSalesOptimiserContent');
    if (!container) return;

    const segment = product.segment;
    let avgPrice = segment.avgPrice;
    let revShare = segment.revShare;
    let trendText = segment.trendText;
    let trendColor = segment.trendColor;
    let isDormant = segment.isDormant;
    let isSeasonalDip = segment.isSeasonalDip;
    let segmentTitle = segment.segmentTitle;
    let segmentBadge = segment.segmentBadge;

    let seoRecommendation = `Create standard descriptive product copy and make sure the SKU is searchable in search engines.`;
    let upsellRecommendation = `Add simple related product links or bundles at checkout to encourage multi-item purchases.`;
    let redirectRecommendation = `Regularly check stock levels to avoid 'out of stock' bounces on search engines.`;

    if (segment.segmentKey === 'seo') {
        seoRecommendation = `<strong>Write target blog guides:</strong> Since this product represents a massive <strong>${revShare.toFixed(2)}%</strong> of your revenue, write dedicated blogs (e.g. buying guides, installation tutorials) and link directly back to this product page. This will drive maximum organic traffic.`;
        upsellRecommendation = `<strong>Premium Upsells:</strong> Target this product page for high-margin accessory cross-sells. Offer small discounts if they add compatible accessories directly from this page.`;
        redirectRecommendation = `<strong>Alternative fallback:</strong> In case this high-value model goes out of stock, create a clear highlighted banner linking to a newer model or direct equivalent to retain the buyer.`;
    } else if (segment.segmentKey === 'cross') {
        seoRecommendation = `<strong>Internal Link Building:</strong> Add internal anchor text from your main category pages and blog index pointing to this page to solidify its positioning as an affordable entry point.`;
        upsellRecommendation = `<strong>Cart Builder / Bundling:</strong> Since this item has a low unit price (${formatCurrency(avgPrice)}) but sells frequently, bundle it with accessories (e.g. buy 3, get 10% off) to drive up your AOV.`;
        redirectRecommendation = `<strong>Premium Upsell Redirection:</strong> Place a clear comparison matrix on the product page showing this entry model next to a premium, higher-margin alternative.`;
    } else if (segment.segmentKey === 'declining') {
        seoRecommendation = `<strong>Content Refresh:</strong> Refresh the product title, features, and metadata. Add common customer questions directly to the product description to target fresh search queries.`;
        upsellRecommendation = `<strong>Promo Campaign:</strong> Run a limited-time bundle discount or coupon code specifically targeting this item to restart sales momentum.`;
        redirectRecommendation = `<strong>Alternative Promotion:</strong> If there is a newer, better model or if this product is discontinued, insert a permanent alert at the top of the description directing users to the newer alternative.`;
    } else if (segment.segmentKey === 'rising') {
        seoRecommendation = `<strong>Feature on Homepage / Newsletter:</strong> Capitalize on this growing product's momentum. Write a quick feature post or showcase it in the next marketing email.`;
        upsellRecommendation = `<strong>Configure Accessories:</strong> As demand rises, ensure all relevant accessories and cleaning kits are configured as cross-sells in WooCommerce to capitalize on cart size.`;
        redirectRecommendation = `<strong>Stock Alerts:</strong> With growing velocity, double-check inventory levels with supplier to ensure stock is maintained.`;
    } else if (isDormant) {
        seoRecommendation = `<strong>Dormant Product Copy:</strong> This product has not recorded sales in the last 3 months. Review if the product page is still published, check search keyword impressions, or consider archiving it.`;
        upsellRecommendation = `<strong>Clearance Promotion:</strong> Try bundling this dormant inventory with your top sellers to clear it out, or run a clearance sale.`;
        redirectRecommendation = `<strong>Discontinued check:</strong> If this product is permanently unavailable, setup a 301 redirect to the nearest equivalent category page.`;
    } else if (isSeasonalDip) {
        seoRecommendation = `<strong>Seasonal Traffic Maintenance:</strong> Sales are dipping MoM but are stable YoY. Maintain page updates and continue targeting off-season search queries (e.g. winter chainsaw maintenance).`;
        upsellRecommendation = `<strong>Off-Season Bundles:</strong> Offer special off-season discounts or pre-season service bundles to stimulate sales during slow months.`;
        redirectRecommendation = `<strong>Stock Management:</strong> Prepare inventory levels in advance for the upcoming peak season based on last year's trends.`;
    }

    const getCheckKey = (key, taskIdx) => `opt_chk_${key.replace(/[^a-zA-Z0-9]/g, '_')}_${taskIdx}`;
    
    const tasks = [
        `Write/refresh blog content & add links back to this product page.`,
        `Add cross-sell accessories / add-ons in WooCommerce product settings.`,
        `Insert a premium banner linking to a newer model / alternative.`,
        `Inspect product image quality and customer reviews to optimize conversion rates.`
    ];

    let checklistHtml = '';
    tasks.forEach((task, idx) => {
        let key = getCheckKey(product.key, idx);
        let checked = localStorage.getItem(key) === 'true' ? 'checked' : '';
        checklistHtml += `
            <div style="display: flex; align-items: flex-start; gap: 0.75rem; margin-bottom: 0.6rem; padding: 0.4rem 0.6rem; border-radius: 4px; transition: background 0.2s;">
                <input type="checkbox" id="${key}" ${checked} style="margin-top: 0.25rem; cursor: pointer;" onchange="localStorage.setItem('${key}', this.checked)">
                <label for="${key}" style="font-size: 0.9rem; color: #373737; cursor: pointer; line-height: 1.4;">${task}</label>
            </div>
        `;
    });

    container.innerHTML = `
        <div class="dashboard-grid" style="grid-template-columns: 1fr 1fr; gap: 2rem; margin-bottom: 0;">
            <div>
                <h4 style="font-size: 1.1rem; font-weight: 600; margin-bottom: 1rem; color: #1E293B; display: flex; align-items: center; gap: 0.5rem; border-bottom: 1px solid #E2E8F0; padding-bottom: 0.5rem;">
                    <span>📊</span> Diagnostic Summary
                </h4>
                
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem;">
                    <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 6px; padding: 0.75rem;">
                        <span style="font-size: 0.75rem; color: #64748B; font-weight: 600; text-transform: uppercase;">Average Price</span>
                        <span style="display: block; font-size: 1.25rem; font-weight: 700; color: #373737; margin-top: 0.25rem;">${formatCurrency(avgPrice)}</span>
                    </div>
                    <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 6px; padding: 0.75rem;">
                        <span style="font-size: 0.75rem; color: #64748B; font-weight: 600; text-transform: uppercase;">Sales Trend</span>
                        <span style="display: block; font-size: 1.15rem; font-weight: 700; color: ${trendColor}; margin-top: 0.25rem;">${trendText}</span>
                    </div>
                    <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 6px; padding: 0.75rem;">
                        <span style="font-size: 0.75rem; color: #64748B; font-weight: 600; text-transform: uppercase;">Revenue Share</span>
                        <span style="display: block; font-size: 1.25rem; font-weight: 700; color: #373737; margin-top: 0.25rem;">${revShare.toFixed(2)}%</span>
                    </div>
                    <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 6px; padding: 0.75rem;">
                        <span style="font-size: 0.75rem; color: #64748B; font-weight: 600; text-transform: uppercase;">Segment Tag</span>
                        <span style="display: block; margin-top: 0.35rem;">${segmentBadge}</span>
                    </div>
                </div>

                <div style="background: #FFFBEB; border: 1px solid #FDE68A; border-radius: 8px; padding: 1rem; border-left: 4px solid #D97706;">
                    <h5 style="font-weight: 700; font-size: 0.85rem; color: #92400E; margin-bottom: 0.4rem; text-transform: uppercase; letter-spacing: 0.05em;">Actionable Summary</h5>
                    <p style="font-size: 0.875rem; color: #78350F; margin: 0; line-height: 1.5;">
                        This product is classified as a <strong>${segmentTitle}</strong>. 
                        To maximize profit, prioritize adding internal SEO links and configuring WooCommerce cross-sells.
                    </p>
                </div>
            </div>

            <div>
                <h4 style="font-size: 1.1rem; font-weight: 600; margin-bottom: 1rem; color: #1E293B; display: flex; align-items: center; gap: 0.5rem; border-bottom: 1px solid #E2E8F0; padding-bottom: 0.5rem;">
                    <span>⚙️</span> Recommended Optimization Steps
                </h4>

                <div style="display: flex; flex-direction: column; gap: 1rem; margin-bottom: 1.25rem;">
                    <div style="display: flex; gap: 0.75rem; align-items: flex-start;">
                        <span style="font-size: 1.25rem;">📝</span>
                        <div>
                            <span style="font-weight: 600; font-size: 0.875rem; color: #475569; display: block;">SEO &amp; Content Strategy</span>
                            <p style="font-size: 0.875rem; color: #373737; margin: 0.2rem 0 0 0; line-height: 1.4;">${seoRecommendation}</p>
                        </div>
                    </div>
                    <div style="display: flex; gap: 0.75rem; align-items: flex-start;">
                        <span style="font-size: 1.25rem;">🛒</span>
                        <div>
                            <span style="font-weight: 600; font-size: 0.875rem; color: #475569; display: block;">Upsells &amp; Cross-Sells</span>
                            <p style="font-size: 0.875rem; color: #373737; margin: 0.2rem 0 0 0; line-height: 1.4;">${upsellRecommendation}</p>
                        </div>
                    </div>
                    <div style="display: flex; gap: 0.75rem; align-items: flex-start;">
                        <span style="font-size: 1.25rem;">🔄</span>
                        <div>
                            <span style="font-weight: 600; font-size: 0.875rem; color: #475569; display: block;">Alternative / Redirection Banners</span>
                            <p style="font-size: 0.875rem; color: #373737; margin: 0.2rem 0 0 0; line-height: 1.4;">${redirectRecommendation}</p>
                        </div>
                    </div>
                </div>

                <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 1rem;">
                    <h5 style="font-weight: 700; font-size: 0.85rem; color: #475569; margin-bottom: 0.6rem; text-transform: uppercase; letter-spacing: 0.05em; display: flex; justify-content: space-between; align-items: center;">
                        <span>Merchant Checklist</span>
                        <span style="font-size: 0.75rem; font-weight: normal; text-transform: none; color: #64748B;">Auto-saved locally</span>
                    </h5>
                    
                    <div style="display: flex; flex-direction: column;">
                        ${checklistHtml}
                    </div>
                </div>
            </div>
        </div>
    `;
}
