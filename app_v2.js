// Global State
let appData = {
    raw: [],
    processed: null
};

// SQL Queries for Developer Tab - Highly Detailed Magento-style Schema
const sqlScripts = [
    {
        title: "1. Master KPI Export (Revenue, Orders, AOV)",
        query: `-- Master query for Executive Summary Tab
SELECT 
    DATE_TRUNC('day', o.created_at) as order_date,
    COUNT(o.entity_id) as total_orders,
    SUM(o.base_grand_total) as total_revenue,
    SUM(o.base_grand_total) / COUNT(o.entity_id) as average_order_value,
    s.name as store_name
FROM sales_order o
JOIN store s ON o.store_id = s.store_id
WHERE o.created_at >= '2026-04-01' -- Change to your reporting start date
AND o.created_at <= '2026-04-30' -- Change to your reporting end date
AND o.status NOT IN ('canceled', 'closed')
AND s.code = 'briants_view'
GROUP BY 1, 5
ORDER BY 1 ASC;`
    },
    {
        title: "2. Customer Segmentation (Retail/Trade & Repeat Ratio)",
        query: `-- Detailed breakdown for Customer Split Tab
SELECT 
    cg.customer_group_code as segment,
    COUNT(o.entity_id) as orders,
    SUM(o.base_grand_total) as revenue,
    -- Repeat Customer Calculation (Has more than 1 order in lifetime)
    COUNT(CASE WHEN (SELECT COUNT(*) FROM sales_order WHERE customer_email = o.customer_email) > 1 THEN 1 END) as repeat_customer_orders,
    COUNT(CASE WHEN (SELECT COUNT(*) FROM sales_order WHERE customer_email = o.customer_email) = 1 THEN 1 END) as new_customer_orders
FROM sales_order o
JOIN customer_group cg ON o.customer_group_id = cg.customer_group_id
WHERE o.created_at >= '2026-04-01' 
AND o.status NOT IN ('canceled')
GROUP BY 1
ORDER BY revenue DESC;`
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
    -- Growth calculation (Placeholder for comparison logic)
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
document.addEventListener('DOMContentLoaded', () => {
    console.log("App Initialized. SQL Hub Unlocked.");
    initTabs();
    initFileUpload();
    initSqlRepository(); // Called immediately to ensure SQL Hub is ready
    initGeminiIntegration();
    
    // Render initial empty charts with placeholders
    renderCharts();
});

// Tab Navigation
function initTabs() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));

            btn.classList.add('active');
            const targetId = btn.getAttribute('data-target');
            const targetEl = document.getElementById(targetId);
            if (targetEl) {
                targetEl.classList.add('active');
            }
        });
    });
}

// File Upload and Parsing
function initFileUpload() {
    const fileInput = document.getElementById('csvFileInput');
    const statusText = document.getElementById('uploadStatus');

    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            statusText.textContent = \`Uploading \${file.name}...\`;
            
            Papa.parse(file, {
                header: true,
                dynamicTyping: true,
                skipEmptyLines: true,
                complete: function(results) {
                    appData.raw = results.data;
                    statusText.textContent = \`Loaded \${results.data.length} rows successfully.\`;
                    statusText.style.color = 'var(--primary-green)';
                    processData(results.data);
                    updateDashboards();
                },
                error: function(error) {
                    statusText.textContent = \`Error: \${error.message}\`;
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
    // Inject dummy KPI values for demo
    document.getElementById('kpi-orders').textContent = Math.floor(Math.random() * 2000) + 500;
    document.getElementById('kpi-revenue').textContent = '£' + (Math.floor(Math.random() * 150000) + 50000).toLocaleString();
    document.getElementById('kpi-aov').textContent = '£' + (Math.floor(Math.random() * 150) + 80);
    
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
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
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
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
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

function renderBarChart(canvasId, labels, data, datasetLabel, color, axis = 'x') {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (window[canvasId] instanceof Chart) window[canvasId].destroy();
    window[canvasId] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{ label: datasetLabel, data: data, backgroundColor: color }]
        },
        options: { responsive: true, maintainAspectRatio: false, indexAxis: axis }
    });
}

function fillTables() {
    const topPerformersTbody = document.querySelector('#topPerformersTable tbody');
    if (topPerformersTbody) {
        topPerformersTbody.innerHTML = \`
            <tr><td>BR-101</td><td>Closeboard Panel 6x6</td><td>480</td><td>£14,400</td></tr>
            <tr><td>STIHL-AP300S</td><td>AP 300 S Battery</td><td>125</td><td>£12,375</td></tr>
            <tr><td>BR-202</td><td>Gravel Board 2.4m</td><td>890</td><td>£7,120</td></tr>
        \`;
    }

    const moversTbody = document.querySelector('#moversTable tbody');
    if (moversTbody) {
        moversTbody.innerHTML = \`
            <tr><td>STIHL-MSA120</td><td>MSA 120 C-B Chainsaw</td><td style="color:var(--primary-green)">+142%</td></tr>
            <tr><td>BR-POST-10</td><td>Concrete Post 10ft</td><td style="color:var(--primary-green)">+35%</td></tr>
        \`;
    }
}

// SQL Repository Implementation
function initSqlRepository() {
    const container = document.getElementById('sqlScriptsContainer');
    if (!container) return;
    
    // Clear container to avoid duplicate initialization if called multiple times
    container.innerHTML = '';
    
    sqlScripts.forEach((script, index) => {
        const block = document.createElement('div');
        block.className = 'sql-script-block';
        
        block.innerHTML = \`
            <div class="sql-header">
                <h3>\${script.title}</h3>
                <button class="btn-secondary copy-btn" data-index="\${index}">Copy to Clipboard</button>
            </div>
            <textarea id="sql-editor-\${index}">\${script.query}</textarea>
        \`;
        
        container.appendChild(block);
        
        CodeMirror.fromTextArea(document.getElementById(\`sql-editor-\${index}\`), {
            mode: "text/x-sql",
            theme: "dracula",
            readOnly: true,
            lineNumbers: true,
            lineWrapping: true
        });
    });

    // Delegated Event for Copying
    container.addEventListener('click', (e) => {
        if (e.target.classList.contains('copy-btn')) {
            const index = e.target.getAttribute('data-index');
            navigator.clipboard.writeText(sqlScripts[index].query).then(() => {
                const originalText = e.target.textContent;
                e.target.textContent = 'Copied!';
                e.target.style.backgroundColor = 'var(--primary-green)';
                e.target.style.color = '#fff';
                
                setTimeout(() => {
                    e.target.textContent = originalText;
                    e.target.style.backgroundColor = 'var(--accent-yellow)';
                    e.target.style.color = 'var(--main-text)';
                }, 2000);
            });
        }
    });
}

// Gemini API Integration
function initGeminiIntegration() {
    const generateBtn = document.getElementById('generateInsightsBtn');
    const contentArea = document.getElementById('insightsContent');
    const apiKeyInput = document.getElementById('geminiApiKey');

    if (!generateBtn) return;

    generateBtn.addEventListener('click', async () => {
        const apiKey = apiKeyInput.value.trim();
        if (!apiKey) {
            contentArea.innerHTML = '<p style="color: #EF4444;">Please enter a valid Gemini API key.</p>';
            return;
        }

        generateBtn.textContent = 'Generating...';
        generateBtn.disabled = true;
        contentArea.innerHTML = '<p>Analyzing Briants metrics...</p>';

        try {
            const prompt = \`Act as a senior e-commerce analyst for Briants. Summarize performance based on: 
            Revenue, Orders, AOV, Customer Split (Retail/Trade), Shipping (C&C/Delivery), and Product Categories (Fencing/Machinery).
            Keep it professional and concise (2 paragraphs).\`;

            const response = await fetch(\`https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=\${apiKey}\`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
            });

            const result = await response.json();
            if (result.error) throw new Error(result.error.message);
            const textResponse = result.candidates[0].content.parts[0].text;
            contentArea.innerHTML = textResponse.split('\\n\\n').map(p => \`<p>\${p}</p>\`).join('');
        } catch (error) {
            contentArea.innerHTML = \`<p style="color: #EF4444;">Error: \${error.message}</p>\`;
        } finally {
            generateBtn.textContent = 'Generate Insights';
            generateBtn.disabled = false;
        }
    });
}
