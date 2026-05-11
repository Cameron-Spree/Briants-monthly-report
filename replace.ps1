$content = Get-Content -Raw app_v2.js
$newContent = @'
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
        return `${d.getFullYear()}-${m}-${day}`;
    };
    
    let curStartStr = formatDate(currentStart);
    let curEndStr = formatDate(currentEnd);
    let prevStartStr = formatDate(lastMonthStart);
    let prevEndStr = formatDate(lastMonthEnd);
    let yoyStartStr = formatDate(lastYearStart);
    let yoyEndStr = formatDate(lastYearEnd);
    
    // Format labels: "Apr 26"
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const formatLabel = (d) => `${monthNames[d.getMonth()]} ${d.getFullYear().toString().substring(2)}`;
    
    let curLabel = formatLabel(currentStart);
    let prevLabel = formatLabel(lastMonthStart);
    let yoyLabel = formatLabel(lastYearStart);

    return [
        {
            title: "1. Master KPI Export (Revenue, Orders, AOV)",
            query: `SELECT 
    CASE 
        WHEN p.post_date >= '${curStartStr} 00:00:00' AND p.post_date <= '${curEndStr} 23:59:59' THEN '1. Current Month (${curLabel})'
        WHEN p.post_date >= '${prevStartStr} 00:00:00' AND p.post_date <= '${prevEndStr} 23:59:59' THEN '2. Last Month (${prevLabel})'
        WHEN p.post_date >= '${yoyStartStr} 00:00:00' AND p.post_date <= '${yoyEndStr} 23:59:59' THEN '3. Last Year YoY (${yoyLabel})'
    END AS reporting_period,
    COUNT(DISTINCT p.ID) AS total_orders,
    SUM(pm.meta_value) AS total_revenue,
    SUM(pm.meta_value) / COUNT(DISTINCT p.ID) AS average_order_value
FROM wp_posts p
JOIN wp_postmeta pm ON p.ID = pm.post_id AND pm.meta_key = '_order_total'
WHERE p.post_type = 'shop_order' 
  AND p.post_status IN ('wc-completed', 'wc-processing')
  AND (
      (p.post_date >= '${curStartStr} 00:00:00' AND p.post_date <= '${curEndStr} 23:59:59') OR
      (p.post_date >= '${prevStartStr} 00:00:00' AND p.post_date <= '${prevEndStr} 23:59:59') OR
      (p.post_date >= '${yoyStartStr} 00:00:00' AND p.post_date <= '${yoyEndStr} 23:59:59')
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
            WHEN p.post_date >= '${curStartStr} 00:00:00' AND p.post_date <= '${curEndStr} 23:59:59' THEN '1. Current Month (${curLabel})'
            WHEN p.post_date >= '${prevStartStr} 00:00:00' AND p.post_date <= '${prevEndStr} 23:59:59' THEN '2. Last Month (${prevLabel})'
            WHEN p.post_date >= '${yoyStartStr} 00:00:00' AND p.post_date <= '${yoyEndStr} 23:59:59' THEN '3. Last Year YoY (${yoyLabel})'
        END AS reporting_period,
        CASE 
            WHEN p.post_date >= '${curStartStr} 00:00:00' AND p.post_date <= '${curEndStr} 23:59:59' THEN '${curStartStr}'
            WHEN p.post_date >= '${prevStartStr} 00:00:00' AND p.post_date <= '${prevEndStr} 23:59:59' THEN '${prevStartStr}'
            WHEN p.post_date >= '${yoyStartStr} 00:00:00' AND p.post_date <= '${yoyEndStr} 23:59:59' THEN '${yoyStartStr}'
        END AS period_start_date,
        MAX(CASE WHEN pm.meta_key = '_order_total' THEN pm.meta_value END) AS total_amount,
        MAX(CASE WHEN pm.meta_key = '_billing_email' THEN pm.meta_value END) AS customer_email
    FROM wp_posts p
    JOIN wp_postmeta pm ON p.ID = pm.post_id
    WHERE p.post_type = 'shop_order' 
      AND p.post_status IN ('wc-completed', 'wc-processing')
      AND (
          (p.post_date >= '${curStartStr} 00:00:00' AND p.post_date <= '${curEndStr} 23:59:59') OR
          (p.post_date >= '${prevStartStr} 00:00:00' AND p.post_date <= '${prevEndStr} 23:59:59') OR
          (p.post_date >= '${yoyStartStr} 00:00:00' AND p.post_date <= '${yoyEndStr} 23:59:59')
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
            query: `SELECT 
    CASE 
        WHEN p.post_date >= '${curStartStr} 00:00:00' AND p.post_date <= '${curEndStr} 23:59:59' THEN '1. Current Month (${curLabel})'
        WHEN p.post_date >= '${prevStartStr} 00:00:00' AND p.post_date <= '${prevEndStr} 23:59:59' THEN '2. Last Month (${prevLabel})'
        WHEN p.post_date >= '${yoyStartStr} 00:00:00' AND p.post_date <= '${yoyEndStr} 23:59:59' THEN '3. Last Year YoY (${yoyLabel})'
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
      (p.post_date >= '${curStartStr} 00:00:00' AND p.post_date <= '${curEndStr} 23:59:59') OR
      (p.post_date >= '${prevStartStr} 00:00:00' AND p.post_date <= '${prevEndStr} 23:59:59') OR
      (p.post_date >= '${yoyStartStr} 00:00:00' AND p.post_date <= '${yoyEndStr} 23:59:59')
  )
GROUP BY reporting_period, shipping_method_name
ORDER BY reporting_period, total_orders DESC;`
        },
        {
            title: "4. Product Performance Deep Dive",
            query: `SELECT
    COALESCE(NULLIF(var_p.post_title, ''), parent_p.post_title) AS \`Product title\`,
    pm_sku.meta_value AS \`SKU\`,

    sales.\`${curLabel} Units\`,
    sales.\`${curLabel} N. Revenue\`,
    sales.\`${curLabel} Orders\`,

    sales.\`${prevLabel} Units\`,
    sales.\`${prevLabel} N. Revenue\`,
    sales.\`${prevLabel} Orders\`,

    sales.\`${yoyLabel} Units\`,
    sales.\`${yoyLabel} N. Revenue\`,
    sales.\`${yoyLabel} Orders\`,

    (
        SELECT GROUP_CONCAT(t.name SEPARATOR ', ')
        FROM wp_term_relationships tr
        JOIN wp_term_taxonomy tt
            ON tt.term_taxonomy_id = tr.term_taxonomy_id
           AND tt.taxonomy = 'product_cat'
        JOIN wp_terms t
            ON t.term_id = tt.term_id
        WHERE tr.object_id = sales.product_id
    ) AS \`Category\`

FROM (
    SELECT
        opl.product_id,
        opl.variation_id,

        SUM(
            CASE
                WHEN opl.date_created >= '${curStartStr} 00:00:00'
                 AND opl.date_created <= '${curEndStr} 23:59:59'
                THEN opl.product_qty
                ELSE 0
            END
        ) AS \`${curLabel} Units\`,

        SUM(
            CASE
                WHEN opl.date_created >= '${curStartStr} 00:00:00'
                 AND opl.date_created <= '${curEndStr} 23:59:59'
                THEN opl.product_net_revenue
                ELSE 0
            END
        ) AS \`${curLabel} N. Revenue\`,

        COUNT(
            DISTINCT CASE
                WHEN opl.date_created >= '${curStartStr} 00:00:00'
                 AND opl.date_created <= '${curEndStr} 23:59:59'
                THEN opl.order_id
            END
        ) AS \`${curLabel} Orders\`,


        SUM(
            CASE
                WHEN opl.date_created >= '${prevStartStr} 00:00:00'
                 AND opl.date_created <= '${prevEndStr} 23:59:59'
                THEN opl.product_qty
                ELSE 0
            END
        ) AS \`${prevLabel} Units\`,

        SUM(
            CASE
                WHEN opl.date_created >= '${prevStartStr} 00:00:00'
                 AND opl.date_created <= '${prevEndStr} 23:59:59'
                THEN opl.product_net_revenue
                ELSE 0
            END
        ) AS \`${prevLabel} N. Revenue\`,

        COUNT(
            DISTINCT CASE
                WHEN opl.date_created >= '${prevStartStr} 00:00:00'
                 AND opl.date_created <= '${prevEndStr} 23:59:59'
                THEN opl.order_id
            END
        ) AS \`${prevLabel} Orders\`,


        SUM(
            CASE
                WHEN opl.date_created >= '${yoyStartStr} 00:00:00'
                 AND opl.date_created <= '${yoyEndStr} 23:59:59'
                THEN opl.product_qty
                ELSE 0
            END
        ) AS \`${yoyLabel} Units\`,

        SUM(
            CASE
                WHEN opl.date_created >= '${yoyStartStr} 00:00:00'
                 AND opl.date_created <= '${yoyEndStr} 23:59:59'
                THEN opl.product_net_revenue
                ELSE 0
            END
        ) AS \`${yoyLabel} N. Revenue\`,

        COUNT(
            DISTINCT CASE
                WHEN opl.date_created >= '${yoyStartStr} 00:00:00'
                 AND opl.date_created <= '${yoyEndStr} 23:59:59'
                THEN opl.order_id
            END
        ) AS \`${yoyLabel} Orders\`

    FROM wp_wc_order_product_lookup opl
    JOIN wp_wc_order_stats os
        ON os.order_id = opl.order_id

    WHERE os.status NOT IN ('wc-pending', 'wc-cancelled', 'wc-refunded', 'wc-failed', 'trash', 'wc-trash')
      AND (
            (
                opl.date_created >= '${curStartStr} 00:00:00'
                AND opl.date_created <= '${curEndStr} 23:59:59'
            )
         OR (
                opl.date_created >= '${prevStartStr} 00:00:00'
                AND opl.date_created <= '${prevEndStr} 23:59:59'
            )
         OR (
                opl.date_created >= '${yoyStartStr} 00:00:00'
                AND opl.date_created <= '${yoyEndStr} 23:59:59'
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
    sales.\`${curLabel} N. Revenue\` DESC,
    sales.\`${prevLabel} N. Revenue\` DESC,
    sales.\`${yoyLabel} N. Revenue\` DESC;`
        },
        {
            title: "5. Payment Gateway Distribution",
            query: `SELECT 
    COALESCE(pm_pay.meta_value, 'Unknown/Free') AS \`Payment Gateway\`,
    
    -- Current Month (${curLabel})
    COUNT(DISTINCT CASE WHEN p.post_date >= '${curStartStr} 00:00:00' AND p.post_date <= '${curEndStr} 23:59:59' THEN p.ID END) AS \`${curLabel} Orders\`,
    SUM(CASE WHEN p.post_date >= '${curStartStr} 00:00:00' AND p.post_date <= '${curEndStr} 23:59:59' THEN pm_total.meta_value ELSE 0 END) AS \`${curLabel} Revenue\`,
    
    -- Last Month (${prevLabel})
    COUNT(DISTINCT CASE WHEN p.post_date >= '${prevStartStr} 00:00:00' AND p.post_date <= '${prevEndStr} 23:59:59' THEN p.ID END) AS \`${prevLabel} Orders\`,
    SUM(CASE WHEN p.post_date >= '${prevStartStr} 00:00:00' AND p.post_date <= '${prevEndStr} 23:59:59' THEN pm_total.meta_value ELSE 0 END) AS \`${prevLabel} Revenue\`,
    
    -- Last Year (${yoyLabel})
    COUNT(DISTINCT CASE WHEN p.post_date >= '${yoyStartStr} 00:00:00' AND p.post_date <= '${yoyEndStr} 23:59:59' THEN p.ID END) AS \`${yoyLabel} Orders\`,
    SUM(CASE WHEN p.post_date >= '${yoyStartStr} 00:00:00' AND p.post_date <= '${yoyEndStr} 23:59:59' THEN pm_total.meta_value ELSE 0 END) AS \`${yoyLabel} Revenue\`

FROM wp_posts p
JOIN wp_postmeta pm_total ON p.ID = pm_total.post_id AND pm_total.meta_key = '_order_total'
LEFT JOIN wp_postmeta pm_pay ON p.ID = pm_pay.post_id AND pm_pay.meta_key = '_payment_method_title'
WHERE p.post_type = 'shop_order'
  AND p.post_status NOT IN ('wc-pending', 'wc-cancelled', 'wc-refunded', 'wc-failed', 'trash', 'wc-trash')
  AND (
      (p.post_date >= '${curStartStr} 00:00:00' AND p.post_date <= '${curEndStr} 23:59:59') OR
      (p.post_date >= '${prevStartStr} 00:00:00' AND p.post_date <= '${prevEndStr} 23:59:59') OR
      (p.post_date >= '${yoyStartStr} 00:00:00' AND p.post_date <= '${yoyEndStr} 23:59:59')
  )
GROUP BY \`Payment Gateway\`
ORDER BY \`${curLabel} Revenue\` DESC;`
        }
    ];
}
'@

$lines = $content -split "`r`n|`n"
$output = @()

$inSqlScripts = $false
foreach ($line in $lines) {
    if ($line -match "^const sqlScripts = \[") {
        $inSqlScripts = $true
        $output += $newContent
        continue
    }
    
    if ($inSqlScripts) {
        if ($line -match "^\];") {
            $inSqlScripts = $false
        }
        continue
    }
    
    $output += $line
}

$output -join "`n" | Out-File -Encoding UTF8 app_v2.js
