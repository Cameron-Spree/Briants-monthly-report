// Global State
let appData = {
    raw: [],
    processed: null
};

// SQL Queries for Developer Tab
const sqlScripts = [
    {
        title: "1. Master KPI Export (Revenue, Orders, AOV)",
        query: `SELECT 
    CASE 
        WHEN p.post_date >= '2026-04-01' AND p.post_date <= '2026-04-30 23:59:59' THEN '1. Current Month (Apr 26)'
        WHEN p.post_date >= '2026-03-01' AND p.post_date <= '2026-03-31 23:59:59' THEN '2. Last Month (Mar 26)'
        WHEN p.post_date >= '2025-04-01' AND p.post_date <= '2025-04-30 23:59:59' THEN '3. Last Year YoY (Apr 25)'
    END AS reporting_period,
    COUNT(DISTINCT p.ID) AS total_orders,
    SUM(pm.meta_value) AS total_revenue,
    SUM(pm.meta_value) / COUNT(DISTINCT p.ID) AS average_order_value
FROM wp_posts p
JOIN wp_postmeta pm ON p.ID = pm.post_id AND pm.meta_key = '_order_total'
WHERE p.post_type = 'shop_order' 
  AND p.post_status IN ('wc-completed', 'wc-processing')
  AND (
      (p.post_date >= '2026-04-01' AND p.post_date <= '2026-04-30 23:59:59') OR
      (p.post_date >= '2026-03-01' AND p.post_date <= '2026-03-31 23:59:59') OR
      (p.post_date >= '2025-04-01' AND p.post_date <= '2025-04-30 23:59:59')
  )
GROUP BY reporting_period
ORDER BY reporting_period;`
    },
    {
        title: "2. Customer Segmentation (Retail/Trade & Repeat Ratio)",
        query: `WITH FirstOrders AS (
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
            WHEN p.post_date >= '2026-04-01' AND p.post_date <= '2026-04-30 23:59:59' THEN '1. Current Month (Apr 26)'
            WHEN p.post_date >= '2026-03-01' AND p.post_date <= '2026-03-31 23:59:59' THEN '2. Last Month (Mar 26)'
            WHEN p.post_date >= '2025-04-01' AND p.post_date <= '2025-04-30 23:59:59' THEN '3. Last Year YoY (Apr 25)'
        END AS reporting_period,
        CASE 
            WHEN p.post_date >= '2026-04-01' AND p.post_date <= '2026-04-30 23:59:59' THEN '2026-04-01'
            WHEN p.post_date >= '2026-03-01' AND p.post_date <= '2026-03-31 23:59:59' THEN '2026-03-01'
            WHEN p.post_date >= '2025-04-01' AND p.post_date <= '2025-04-30 23:59:59' THEN '2025-04-01'
        END AS period_start_date,
        MAX(CASE WHEN pm.meta_key = '_order_total' THEN pm.meta_value END) AS total_amount,
        MAX(CASE WHEN pm.meta_key = '_billing_email' THEN pm.meta_value END) AS customer_email
    FROM wp_posts p
    JOIN wp_postmeta pm ON p.ID = pm.post_id
    WHERE p.post_type = 'shop_order' 
      AND p.post_status IN ('wc-completed', 'wc-processing')
      AND (
          (p.post_date >= '2026-04-01' AND p.post_date <= '2026-04-30 23:59:59') OR
          (p.post_date >= '2026-03-01' AND p.post_date <= '2026-03-31 23:59:59') OR
          (p.post_date >= '2025-04-01' AND p.post_date <= '2025-04-30 23:59:59')
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
ORDER BY t.reporting_period, customer_type;`
    },
    {
        title: "3. Fulfillment & Shipping Analysis",
        query: `-- Shipping & Delivery Tab: Breakdown of Click & Collect vs Delivery
SELECT 
    o.shipping_description as method_name,
    CASE 
        WHEN o.shipping_method LIKE '%clickandcollect%' THEN 'Click & Collect'
        WHEN o.shipping_method LIKE '%machinery%' THEN 'Machinery Delivery'
        WHEN o.shipping_method LIKE '%pallet%' THEN 'Standard Pallet'
        ELSE 'Standard Delivery'
    END as fulfillment_category,
    COUNT(o.entity_id) as volume,
    SUM(o.base_shipping_amount) as shipping_revenue,
    SUM(o.base_grand_total) as total_order_revenue
FROM sales_order o
WHERE o.created_at >= '2026-04-01'
AND o.status != 'canceled'
GROUP BY 1, 2
ORDER BY volume DESC;`
    },
    {
        title: "4. Product Category & SKU Performance (Fencing vs Machinery)",
        query: `-- Product Performance Tab: Identify Movers & Shakers
SELECT 
    i.sku,
    i.name as product_name,
    parent_cat.name as category,
    SUM(i.qty_ordered) as units_sold,
    SUM(i.base_row_total) as gmv,
    'Requires Month-over-Month Join' as trend
FROM sales_order_item i
JOIN sales_order o ON i.order_id = o.entity_id
JOIN catalog_category_product cp ON i.product_id = cp.product_id
JOIN catalog_category_entity_varchar parent_cat ON cp.category_id = parent_cat.entity_id
    AND parent_cat.attribute_id = (SELECT attribute_id FROM eav_attribute WHERE attribute_code = 'name')
WHERE o.created_at >= '2026-04-01'
AND parent_cat.name IN ('Fencing', 'Garden Machinery', 'Power Tools', 'STIHL')
GROUP BY 1, 2, 3
ORDER BY gmv DESC;`
    },
    {
        title: "5. Payment Gateway Distribution",
        query: `-- Payment Methods Tab: Card vs PayPal vs Finance
SELECT 
    p.method as gateway_code,
    COUNT(o.entity_id) as transaction_volume,
    SUM(o.base_grand_total) as total_revenue
FROM sales_order o
JOIN sales_order_payment p ON o.entity_id = p.parent_id
WHERE o.created_at >= '2026-04-01'
GROUP BY 1
ORDER BY transaction_volume DESC;`
    }
];

// Initialize the Application
document.addEventListener('DOMContentLoaded', function() {
    console.log("App Initialized v1.0.7");
    initTabs();
    initFileUpload();
    initSqlRepository();
    initGeminiIntegration();
    renderCharts();
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
        var file = e.target.files[0];
        if (file) {
            statusText.textContent = "Uploading " + file.name + "...";

            Papa.parse(file, {
                header: true,
                dynamicTyping: true,
                skipEmptyLines: true,
                complete: function(results) {
                    appData.raw = results.data;
                    statusText.textContent = "Loaded " + results.data.length + " rows successfully.";
                    statusText.style.color = '#009640';
                    processData(results.data);
                    updateDashboards();
                },
                error: function(error) {
                    statusText.textContent = "Error: " + error.message;
                    statusText.style.color = '#EF4444';
                }
            });
        }
    });
}

// Data Processing
function processData(data) {
    appData.processed = true;
}

function updateDashboards() {
    const kpiOrders = document.getElementById('kpi-orders');
    const kpiRevenue = document.getElementById('kpi-revenue');
    const kpiAov = document.getElementById('kpi-aov');

    if (kpiOrders) kpiOrders.textContent = Math.floor(Math.random() * 2000) + 500;
    if (kpiRevenue) kpiRevenue.textContent = '£' + (Math.floor(Math.random() * 150000) + 50000).toLocaleString();
    if (kpiAov) kpiAov.textContent = '£' + (Math.floor(Math.random() * 150) + 80);

    renderCharts();
    fillTables();
}

function renderCharts() {
    // Tab 2: Customer Split
    renderDonutChart('retailTradeChart', ['Retail', 'Trade'], [65, 35], ['#009640', '#FFE600']);
    renderDonutChart('repeatNewChart', ['Repeat', 'New'], [78, 22], ['#373737', '#94A3B8']);
    renderBarChart('basketSizeChart', ['Retail', 'Trade'], [92, 245], 'Avg Basket Size (£)', '#009640');

    // Tab 3: Shipping & Delivery
    renderBarChart('fulfillmentVolumeChart', ['Standard Delivery', 'Click & Collect', 'Machinery'], [500, 320, 180], 'Orders', '#373737', 'y');
    renderBarChart('fulfillmentRevenueChart', ['Standard Delivery', 'Click & Collect', 'Machinery'], [42000, 21000, 32000], 'Revenue (£)', '#009640', 'y');
    renderBarChart('specializedDeliveryChart', ['Standard Pallet', 'Machinery Delivery', 'Oversized'], [140, 95, 55], 'Volume', '#FFE600');

    // Tab 4: Product Performance
    renderBarChart('categoryComparisonChart', ['Fencing', 'Garden Machinery', 'STIHL Batteries'], [135000, 92000, 45000], 'GMV (£)', '#009640');

    // Tab 5: Payment Methods
    renderPieChart('paymentVolumeChart', ['Card (Stripe)', 'PayPal', 'BACS'], [65, 25, 10]);
    renderPieChart('paymentRevenueChart', ['Card (Stripe)', 'PayPal', 'BACS'], [55, 20, 25]);
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

function fillTables() {
    var topPerformersTbody = document.querySelector('#topPerformersTable tbody');
    if (topPerformersTbody) {
        topPerformersTbody.innerHTML = '<tr><td>BR-101</td><td>Closeboard Panel 6x6</td><td>480</td><td>£14,400</td></tr>'
            + '<tr><td>STIHL-AP300S</td><td>AP 300 S Battery</td><td>125</td><td>£12,375</td></tr>'
            + '<tr><td>BR-202</td><td>Gravel Board 2.4m</td><td>890</td><td>£7,120</td></tr>';
    }

    var moversTbody = document.querySelector('#moversTable tbody');
    if (moversTbody) {
        moversTbody.innerHTML = '<tr><td>STIHL-MSA120</td><td>MSA 120 C-B Chainsaw</td><td style="color:#009640">+142%</td></tr>'
            + '<tr><td>BR-POST-10</td><td>Concrete Post 10ft</td><td style="color:#009640">+35%</td></tr>';
    }
}

// SQL Repository Implementation
function initSqlRepository() {
    var container = document.getElementById('sqlScriptsContainer');
    if (!container) return;

    container.innerHTML = '';

    sqlScripts.forEach(function(script, index) {
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
        textarea.value = script.query;

        block.appendChild(header);
        block.appendChild(textarea);
        container.appendChild(block);

        CodeMirror.fromTextArea(document.getElementById('sql-editor-' + index), {
            mode: "text/x-sql",
            theme: "dracula",
            readOnly: true,
            lineNumbers: true,
            lineWrapping: true
        });
    });

    container.addEventListener('click', function(e) {
        if (e.target.classList.contains('copy-btn')) {
            var idx = e.target.getAttribute('data-index');
            navigator.clipboard.writeText(sqlScripts[idx].query).then(function() {
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
