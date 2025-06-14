import { shopifyApi, LATEST_API_VERSION } from '@shopify/shopify-api';
import { restResources } from '@shopify/shopify-api/rest/admin/2024-01';

export async function getAccessToken(shop) {
  try {
    console.log('Initializing Shopify API with:', {
      shop,
      apiKey: process.env.SHOPIFY_API_KEY ? 'present' : 'missing',
      apiSecret: process.env.SHOPIFY_API_SECRET ? 'present' : 'missing',
      scopes: process.env.SCOPES
    });

    const shopify = shopifyApi({
      apiKey: process.env.SHOPIFY_API_KEY,
      apiSecretKey: process.env.SHOPIFY_API_SECRET,
      scopes: process.env.SCOPES?.split(','),
      hostName: shop.replace(/https?:\/\//, ''),
      apiVersion: '2024-01',
      isEmbeddedApp: true,
      restResources,
    });

    // Create a session with the shop's access token
    const session = await shopify.session.customAppSession(shop);
    
    // Create a REST client with the API key and secret
    const client = new shopify.clients.Rest({
      session: {
        shop,
        accessToken: process.env.SHOPIFY_API_SECRET,
      },
    });

    return {
      accessToken: process.env.SHOPIFY_API_SECRET,
      client,
      session,
    };
  } catch (error) {
    console.error('Error getting access token:', shop, error);
    throw error;
  }
}

export async function getShopifyClient(shop) {
  try {
    const { client, session } = await getAccessToken(shop);
    return { client, session };
  } catch (error) {
    console.error('Error getting Shopify client:', error);
    throw error;
  }
} 