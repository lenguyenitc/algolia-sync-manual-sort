import { json } from "@remix-run/node";
import { AppProvider, Frame, Page, Badge, LegacyCard, DataTable, Button, SkeletonBodyText, SkeletonDisplayText, Toast } from "@shopify/polaris";
import enTranslations from "@shopify/polaris/locales/en.json";
import { Links, Meta, ScrollRestoration, Scripts, useLoaderData, useFetcher } from "@remix-run/react";
import { useState, useEffect } from "react";

// Helper to call Shopify Admin API
async function shopifyGraphQL({ shop, accessToken, query, variables }) {
  const res = await fetch(`https://${shop}/admin/api/2023-10/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({ query, variables }),
  });
  const jsonRes = await res.json();
  return jsonRes.data;
}

// Helper to set product metafield
async function setProductMetafield({ shop, accessToken, productId, key, value }) {
  const mutation = `
    mutation productUpdate($input: ProductInput!) {
      productUpdate(input: $input) {
        product {
          id
        }
        userErrors {
          field
          message
        }
      }
    }
  `;
  const variables = {
    input: {
      id: productId,
      metafields: [
        {
          namespace: "custom",
          key,
          type: "number_integer",
          value: value.toString(),
        },
      ],
    },
  };
  return shopifyGraphQL({ shop, accessToken, query: mutation, variables });
}

export const action = async ({ request }) => {
  const shop = process.env.SHOPIFY_SHOP;
  const accessToken = process.env.SHOPIFY_ACCESS_TOKEN;
  const formData = await request.formData();
  const collectionId = formData.get("collectionId");
  const collectionHandle = formData.get("collectionHandle");

  if (!shop || !accessToken) {
    return json({ error: "Missing shop or access token" }, { status: 401 });
  }

  try {
    console.log("Received action for collection:", collectionId, collectionHandle);

    // 1. Fetch collection details and products in order
    const query = `
      query getCollection($id: ID!) {
        collection(id: $id) {
          id
          handle
          sortOrder
          products(first: 100, sortKey: MANUAL) {
            edges {
              node {
                id
                title
              }
            }
          }
        }
      }
    `;
    const data = await shopifyGraphQL({
      shop,
      accessToken,
      query,
      variables: { id: collectionId },
    });

    const collection = data?.collection;
    if (!collection) {
      console.error("Collection not found:", collectionId);
      return json({ error: "Collection not found" }, { status: 404 });
    }

    // 2. Only proceed if manual sort
    if (collection.sortOrder !== "MANUAL") {
      console.warn("Collection is not manual sort:", collection.sortOrder);
      return json({ error: "Collection is not manual sort" }, { status: 400 });
    }

    // 3. Set metafield for each product with retry logic
    const products = collection.products.edges.map((e) => e.node);
    const results = {
      success: 0,
      failed: 0,
      errors: []
    };

    for (let i = 0; i < products.length; i++) {
      const product = products[i];
      try {
        console.log(
          `Updating product ${product.id} (${product.title}) with key ${collectionHandle}_rank = ${i + 1}`
        );
        await setProductMetafield({
          shop,
          accessToken,
          productId: product.id,
          key: `${collectionHandle}_rank`,
          value: i + 1, // 1-based position
        });
        results.success++;
      } catch (error) {
        console.error(`Failed to update product ${product.id}:`, error);
        results.failed++;
        results.errors.push({
          productId: product.id,
          title: product.title,
          error: error.message
        });
      }
    }

    console.log(`Updated ${results.success} products, failed: ${results.failed} for collection ${collectionHandle}`);
    return json({ 
      success: true, 
      results,
      message: `Successfully updated ${results.success} products${results.failed > 0 ? `, ${results.failed} failed` : ''}`
    });
  } catch (error) {
    console.error("Error processing collection:", error);
    return json({ error: error.message || "An unexpected error occurred" }, { status: 500 });
  }
};

export const loader = async ({ request }) => {
  // You should get these from your session/auth
  const shop = 'bearspress.myshopify.com'; //process.env.SHOPIFY_SHOP;
  const accessToken = process.env.SHOPIFY_ACCESS_TOKEN;

  // if (!shop || !accessToken) return redirect("/auth/login");

  // Query first 10 collections and their sort order
  const query = `
    {
      collections(first: 10) {
        edges {
          node {
            id
            title
            handle
            sortOrder
            products(first: 10, sortKey: MANUAL) {
              edges {
                node {
                  id
                  title
                }
              }
            }
          }
        }
      }
    }
  `;
  const data = await shopifyGraphQL({ shop, accessToken, query });
  console.log('all collections data:', shop, accessToken, query);
  const collections = data.collections.edges.map(({ node }) => ({
    id: node.id,
    title: node.title,
    handle: node.handle,
    sortOrder: node.sortOrder,
    products: node.products.edges.map(({ node }) => ({
      id: node.id,
      title: node.title,
    })),
  }));

  return json({ collections });
};

// Add this export to specify allowed methods
export const config = {
  unstable_allowDynamicGlob: ["**/node_modules/**"],
};

// Add this to specify allowed methods
export const handle = {
  methods: ["GET", "POST"],
};

export default function App() {
  const { collections } = useLoaderData();
  const [toastMessage, setToastMessage] = useState(null);
  const [lastToastId, setLastToastId] = useState(null);

  // If collections are loading, show skeleton
  if (!collections) {
    return (
      <AppProvider i18n={enTranslations}>
        <Page title="Collections">
          <LegacyCard>
            <SkeletonDisplayText size="large" />
            <SkeletonBodyText lines={6} />
          </LegacyCard>
        </Page>
      </AppProvider>
    );
  }

  const rows = collections.map((col) => {
    const rowFetcher = useFetcher();
    const isSubmitting = rowFetcher.state === "submitting";
    const hasError = rowFetcher.data?.error;
    const hasSuccess = rowFetcher.data?.success;

    // Add a unique id for each row (e.g., collection id)
    useEffect(() => {
      if (hasSuccess && !isSubmitting && lastToastId !== col.id) {
        setToastMessage({
          content: rowFetcher.data.message,
          tone: "success"
        });
        setLastToastId(col.id);
      } else if (hasError && !isSubmitting && lastToastId !== col.id) {
        setToastMessage({
          content: rowFetcher.data.error,
          tone: "critical"
        });
        setLastToastId(col.id);
      }
      // eslint-disable-next-line
    }, [hasSuccess, hasError, isSubmitting, rowFetcher.data]);

    return [
      col.title,
      col.sortOrder === "MANUAL" ? <Badge tone="success">Manual</Badge> : col.sortOrder,
      <rowFetcher.Form method="post" action="?index">
        <input type="hidden" name="collectionId" value={col.id} />
        <input type="hidden" name="collectionHandle" value={col.handle} />
        <Button
          submit
          disabled={col.sortOrder !== "MANUAL" || isSubmitting}
          tone={col.sortOrder === "MANUAL" ? "primary" : "critical"}
          loading={isSubmitting}
        >
          {isSubmitting ? "Processing..." : "Render Meta"}
        </Button>
      </rowFetcher.Form>,
    ];
  });

  return (
    <html lang="en">
      <head>
        <Meta />
        <Links />
      </head>
      <body>
        <AppProvider i18n={enTranslations}>
          <Frame>
            <Page title="Collections">
              <LegacyCard>
                <DataTable
                  columnContentTypes={["text", "text", "text"]}
                  headings={["Collection", "Sort Order", "Action"]}
                  rows={rows}
                />
              </LegacyCard>
              {toastMessage && (
                <Toast
                  content={toastMessage.content}
                  tone={toastMessage.tone}
                  onDismiss={() => setToastMessage(null)}
                />
              )}
            </Page>
          </Frame>
        </AppProvider>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
