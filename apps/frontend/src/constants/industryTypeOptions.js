/** Industry sectors offered on the "Industry Type" campaign criterion.
 *  Values stay English so the payload is stable across languages; the labels
 *  here are the English fallback and `newCampaign_combo_industry_*` localizes them. */
export const INDUSTRY_TYPE_OPTIONS = [
    { value: 'Oil & Gas', label: 'Oil & Gas' },
    { value: 'Energy & Power', label: 'Energy & Power' },
    { value: 'Banking & Finance', label: 'Banking & Finance' },
    { value: 'Healthcare & Pharma', label: 'Healthcare & Pharma' },
    { value: 'Information Technology', label: 'Information Technology' },
    { value: 'Telecommunications', label: 'Telecommunications' },
    { value: 'Construction & Engineering', label: 'Construction & Engineering' },
    { value: 'Manufacturing & Industry', label: 'Manufacturing & Industry' },
    { value: 'Retail & E-commerce', label: 'Retail & E-commerce' },
    { value: 'Logistics & Transport', label: 'Logistics & Transport' },
    { value: 'Hospitality & Tourism', label: 'Hospitality & Tourism' },
    { value: 'Education & Training', label: 'Education & Training' },
    { value: 'Government & Public Sector', label: 'Government & Public Sector' },
    { value: 'NGO & Humanitarian', label: 'NGO & Humanitarian' },
    { value: 'Media & Advertising', label: 'Media & Advertising' },
    { value: 'Real Estate', label: 'Real Estate' },
    { value: 'Agriculture & Food', label: 'Agriculture & Food' },
    { value: 'Consulting & Professional Services', label: 'Consulting & Professional Services' },
];

/** value → translation key, same convention as the age / education / experience combos. */
export const NEW_CAMPAIGN_INDUSTRY_OPT_KEY = {
    'Oil & Gas': 'newCampaign_combo_industry_oil_gas',
    'Energy & Power': 'newCampaign_combo_industry_energy',
    'Banking & Finance': 'newCampaign_combo_industry_banking',
    'Healthcare & Pharma': 'newCampaign_combo_industry_healthcare',
    'Information Technology': 'newCampaign_combo_industry_it',
    Telecommunications: 'newCampaign_combo_industry_telecom',
    'Construction & Engineering': 'newCampaign_combo_industry_construction',
    'Manufacturing & Industry': 'newCampaign_combo_industry_manufacturing',
    'Retail & E-commerce': 'newCampaign_combo_industry_retail',
    'Logistics & Transport': 'newCampaign_combo_industry_logistics',
    'Hospitality & Tourism': 'newCampaign_combo_industry_hospitality',
    'Education & Training': 'newCampaign_combo_industry_education',
    'Government & Public Sector': 'newCampaign_combo_industry_government',
    'NGO & Humanitarian': 'newCampaign_combo_industry_ngo',
    'Media & Advertising': 'newCampaign_combo_industry_media',
    'Real Estate': 'newCampaign_combo_industry_realestate',
    'Agriculture & Food': 'newCampaign_combo_industry_agriculture',
    'Consulting & Professional Services': 'newCampaign_combo_industry_consulting',
};
