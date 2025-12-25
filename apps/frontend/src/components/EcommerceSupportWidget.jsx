import React from 'react';
import VapiWidget from './VapiWidget';

const EcommerceSupportWidget = () => {
  return (
    <VapiWidget
      apiKey="your_api_key"
      assistantId="ecommerce_support_assistant_id"
      config={{
        position: 'bottom-right',
        theme: 'ecommerce',
        greeting: 'Hi! Need help with your order?',
        voice: {
          provider: 'playht',
          voiceId: 'jennifer',
        },
      }}
    />
  );
};

export default EcommerceSupportWidget;

