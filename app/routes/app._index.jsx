import { json } from "@remix-run/node";
import {
  AppProvider,
  Frame,
  Page,
  Badge,
  LegacyCard,
  DataTable,
  Button,
  Toast,
  Pagination,
} from "@shopify/polaris";
import enTranslations from "@shopify/polaris/locales/en.json";
import { Links, Meta, ScrollRestoration, Scripts, useLoaderData, useFetcher, useNavigate } from "@remix-run/react";
import { useState, useEffect } from "react";
import { authenticate } from "../shopify.server";

// --- Helper: Update a product's metafield via Shopify Admin GraphQL API ---
async function setProductMetafield({ admin, productId, key, value }) {
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
  const response = await admin.graphql(mutation, { variables });
  const data = await response.json();
  if (data?.data?.productUpdate?.userErrors?.length) {
    console.error("Product metafield update userErrors:", data.data.productUpdate.userErrors);
  }
  return data;
}

// --- Action: Handles POST requests from the UI (e.g., "Render" button) ---
export const action = async ({ request }) => {
  console.log("[action] called with", request.url);
  try {
    // Authenticate the admin session
    const { admin } = await authenticate.admin(request);
    const formData = await request.formData();
    const collectionId = formData.get("collectionId");
    const collectionHandle = formData.get("collectionHandle");

    if (!admin) {
      return json({ error: "Authentication required" }, { status: 401 });
    }

    console.log("Received action for collection:", collectionId, collectionHandle);

    // --- Fetch collection details and products ---
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
    const response = await admin.graphql(query, { variables: { id: collectionId } });
    const data = await response.json();
    console.log("[action] collection data:", JSON.stringify(data));

    const collection = data?.data?.collection;
    if (!collection) {
      console.error("Collection not found:", collectionId);
      return json({ error: "Collection not found" }, { status: 404 });
    }

    if (collection.sortOrder !== "MANUAL") {
      console.warn("Collection is not manual sort:", collection.sortOrder);
      return json({ error: "Collection is not manual sort" }, { status: 400 });
    }

    // --- Set metafield for each product in the collection ---
    const products = collection.products.edges.map((e) => e.node);
    const results = { success: 0, failed: 0, errors: [] };

    for (let i = 0; i < products.length; i++) {
      const product = products[i];
      try {
        console.log(
          `Updating product ${product.id} (${product.title}) with key ${collectionHandle}_rank = ${i + 1}`
        );
        await setProductMetafield({
          admin,
          productId: product.id,
          key: `${collectionHandle}_rank`,
          value: i + 1,
        });
        results.success++;
      } catch (error) {
        console.error(`Failed to update product ${product.id}:`, error);
        results.failed++;
        results.errors.push({
          productId: product.id,
          title: product.title,
          error: error.message,
        });
      }
    }

    console.log(`Updated ${results.success} products, failed: ${results.failed} for collection ${collectionHandle}`);

    // --- Update collection's rendered_at metafield ---
    const now = new Date().toISOString();
    const setMetafieldMutation = `
      mutation collectionUpdate($input: CollectionInput!) {
        collectionUpdate(input: $input) {
          collection {
            id
          }
          userErrors {
            field
            message
          }
        }
      }
    `;
    const metafieldResponse = await admin.graphql(setMetafieldMutation, {
      variables: {
        input: {
          id: collectionId,
          metafields: [
            {
              namespace: "custom",
              key: "rendered_at",
              type: "single_line_text_field",
              value: now,
            },
          ],
        },
      },
    });
    const metafieldData = await metafieldResponse.json();
    console.log("[action] metafield update response:", JSON.stringify(metafieldData));

    return json({
      success: true,
      results,
      message: `Successfully updated ${results.success} products${results.failed > 0 ? `, ${results.failed} failed` : ""}`,
    });
  } catch (error) {
    console.error("Action error:", error);
    if (error.status === 401) {
      return json({ error: "Session expired. Please refresh the page." }, { status: 401 });
    }
    return json({ error: error.message || "An unexpected error occurred" }, { status: 500 });
  }
};

// --- Loader: Loads collections for the current page (pagination support) ---
export const loader = async ({ request }) => {
  console.log("[loader] called with", request.url);
  const { admin, session } = await authenticate.admin(request);
  const shop = session?.shop || process.env.SHOPIFY_SHOP;
  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get("page") || "1", 10);
  const after = url.searchParams.get("after") || null;
  const perPage = 30;

  // --- GraphQL query to fetch paginated collections ---
  const query = `
    query getCollections($first: Int!, $after: String) {
      collections(first: $first, after: $after, query: "sortOrder:MANUAL") {
        pageInfo { hasNextPage hasPreviousPage endCursor startCursor }
        edges {
          cursor
          node {
            id
            title
            handle
            sortOrder
            productsCount { count }
            metafield(namespace: "custom", key: "rendered_at") { value }
          }
        }
      }
    }
  `;

  const response = await admin.graphql(query, {
    variables: { first: perPage, after },
  });
  const data = await response.json();

  if (!data?.data?.collections?.edges) {
    return json({
      collections: [],
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
      currentPage: page,
      perPage,
      shop,
      error: "Collections data is missing or malformed.",
    });
  }

  // --- Format collections for the UI ---
  const collections = data.data.collections.edges.map(({ node, cursor }) => ({
    id: node.id,
    title: node.title,
    handle: node.handle,
    sortOrder: node.sortOrder,
    totalProducts: node.productsCount?.count ?? 0,
    renderedAt: node.metafield?.value || null,
    cursor,
  }));

  return json({
    collections,
    pageInfo: data.data.collections.pageInfo,
    currentPage: page,
    perPage,
    shop,
  });
};

// --- Main React component for the page ---
export default function App() {
  // --- Get initial data from loader ---
  const { collections, pageInfo, currentPage, shop } = useLoaderData();
  const [toastMessage, setToastMessage] = useState(null);
  const [lastToastId, setLastToastId] = useState(null);
  const navigate = useNavigate();
  const fetcher = useFetcher();

  // --- Handle toast messages for action responses ---
  useEffect(() => {
    if (fetcher.data?.success && fetcher.state === "idle" && lastToastId !== fetcher.data.message) {
      setToastMessage({
        content: fetcher.data.message,
        tone: "success",
      });
      setLastToastId(fetcher.data.message);
    } else if (fetcher.data?.error && fetcher.state === "idle" && lastToastId !== fetcher.data.error) {
      if (fetcher.data.error === "Session expired. Please refresh the page.") {
        window.location.reload();
      } else {
        setToastMessage({
          content: fetcher.data.error,
          tone: "critical",
        });
      }
      setLastToastId(fetcher.data.error);
    }
  }, [fetcher.data, fetcher.state, lastToastId]);

  // --- Handle pagination (navigates to new page) ---
  const handlePageChange = (newPage) => {
    const url = new URL(window.location.href);
    const params = new URLSearchParams(url.search);
    params.set("page", newPage.toString());
    if (newPage > currentPage && pageInfo.endCursor) {
      params.set("after", pageInfo.endCursor);
    } else if (newPage < currentPage) {
      params.delete("after");
    }
    navigate(`/app?${params.toString()}`, { replace: true });
  };

  // --- Prepare table rows for DataTable ---
  const rows = collections.map((col) => {
    const isSubmitting = fetcher.state === "submitting";
    const collectionIdShort = col.id.split("/").pop();
    const adminUrl = `https://${shop}/admin/collections/${collectionIdShort}`;

    return [
      <a href={adminUrl} target="_blank" rel="noopener noreferrer">{col.title}</a>,
      col.sortOrder === "MANUAL" ? <Badge tone="success">Manual</Badge> : col.sortOrder,
      col.totalProducts,
      col.renderedAt ? new Date(col.renderedAt).toLocaleString() : "",
      <fetcher.Form method="post">
        <input type="hidden" name="collectionId" value={col.id} />
        <input type="hidden" name="collectionHandle" value={col.handle} />
        <Button submit disabled={isSubmitting || col.sortOrder !== "MANUAL"} loading={isSubmitting}>
          {isSubmitting ? "Processing..." : "Render"}
        </Button>
      </fetcher.Form>,
    ];
  });

  // --- Render the page UI ---
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
                  columnContentTypes={["text", "text", "numeric", "text", "text"]}
                  headings={["Collection", "Sort Order", "Total Products", "Rendered At", "Action"]}
                  rows={rows}
                />
                <div style={{ marginTop: 16, display: "flex", justifyContent: "center" }}>
                  <Pagination
                    hasPrevious={currentPage > 1}
                    onPrevious={() => handlePageChange(currentPage - 1)}
                    hasNext={pageInfo?.hasNextPage}
                    onNext={() => handlePageChange(currentPage + 1)}
                  />
                </div>
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

// --- Remix config for dynamic imports and allowed methods ---
export const config = {
  unstable_allowDynamicGlob: ["**/node_modules/**"],
};

export const handle = {
  methods: ["GET", "POST"],
};