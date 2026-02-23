# IFRS.ai Frontend - Next.js 14 + Tailwind CSS

Enterprise-grade IFRS Accounting AI Platform frontend built with Next.js 14, TypeScript, and Tailwind CSS.

## 🚀 Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Environment Setup

Create a `.env.local` file in the frontend directory:

```env
NEXT_PUBLIC_SUPABASE_URL=your-supabase-project-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
NEXT_PUBLIC_API_URL=http://localhost:8000
```

**Get Supabase Credentials:**
1. Go to [https://supabase.com](https://supabase.com)
2. Create a new project
3. Go to Settings > API
4. Copy Project URL and anon/public key

### 3. Start Development Server

```bash
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000)

### 4. Start Backend API (Required)

In a separate terminal:

```bash
cd ../
python app.py
```

Backend runs at [http://localhost:8000](http://localhost:8000)

---

## 📁 Project Structure

```
frontend/
├── app/                      # Next.js 14 App Router
│   ├── layout.tsx           # Root layout with fonts & toaster
│   ├── page.tsx             # Landing page (/)
│   ├── login/
│   │   └── page.tsx         # Login page (/login)
│   └── dashboard/
│       ├── page.tsx         # Dashboard home
│       ├── ifrs16/
│       │   └── page.tsx     # IFRS 16 calculator
│       ├── ifrs15/
│       │   └── page.tsx     # IFRS 15 calculator
│       ├── ifrs9/
│       │   └── page.tsx     # IFRS 9 calculator
│       └── reports/
│           └── page.tsx     # Reports page
├── components/              # Reusable components
│   ├── Button.tsx          # Button component
│   ├── ChatWidget.tsx      # Floating AI chat
│   ├── DashboardLayout.tsx # Dashboard layout with nav
│   └── KPICard.tsx         # Metric card component
├── hooks/                   # Custom React hooks
│   └── useAuth.ts          # Authentication hook
├── lib/                     # Utilities
│   ├── api.ts              # API client (connects to FastAPI)
│   ├── supabase.ts         # Supabase client
│   └── utils.ts            # Utility functions
├── next.config.ts           # Next.js configuration
├── tailwind.config.ts       # Tailwind CSS configuration
└── package.json
```

---

## 🎨 Features Implemented

### ✅ Landing Page (/)
- Hero section with CTA
- Metrics bar (4 minutes, 100% compliant, etc.)
- How It Works (3 steps)
- Features grid (4 modules)
- Pricing section (Starter & Enterprise)
- Professional footer

### ✅ Authentication (/login)
- Supabase email/password login
- Centered card design
- Form validation
- Error handling with toast notifications

### ✅ Dashboard (/dashboard)
- Greeting with company name
- 4 KPI cards (Liability, ROU Asset, Active Leases, Expiring)
- Line chart (Lease Liability Trend - 6 months)
- Pie chart (Leases by Asset Type)
- Recent calculations table
- Floating AI chat widget (bottom right)

### ✅ IFRS 16 (/dashboard/ifrs16)
- Two tabs: Upload Contract | Manual Entry
- Drag-drop file upload (PDF/DOCX/TXT)
- AI extraction with loading states
- Manual entry form (10 fields)
- Results: 4 metric cards
- Amortization chart (Area chart, first 24 months)
- Download Excel report CTA

### ✅ IFRS 15 (/dashboard/ifrs15)
- Upload contract or paste text
- Results placeholder (ready for API integration)

### ✅ IFRS 9 (/dashboard/ifrs9)
- CSV upload for loan portfolio
- Sample CSV download link
- Staging summary cards (Stage 1/2/3)
- Results placeholder

### ✅ Reports (/dashboard/reports)
- Empty state with prompt to create calculations

### ✅ Components
- **ChatWidget**: Floating AI assistant with RAG integration
- **KPICard**: Reusable metric card with icon & trend
- **DashboardLayout**: Shared layout with top nav & logout
- **Button**: Variants (primary, secondary, ghost, danger)

---

## 🔌 API Integration

All API calls connect to FastAPI backend at `localhost:8000`:

### Endpoints Used:

| Endpoint | Method | Usage |
|----------|--------|-------|
| `/api/calculate` | POST | Calculate IFRS 16 lease |
| `/api/upload-contract` | POST | Upload & extract contract |
| `/api/download/{file_id}` | GET | Download Excel report |
| `/api/chat` | POST | RAG-powered Q&A |
| `/api/rag/stats/{company_id}` | GET | Get document stats |
| `/api/health` | GET | Health check |

### API Client (`lib/api.ts`)

```typescript
import { ifrs16Api } from '@/lib/api';

// Calculate lease
const { data, error } = await ifrs16Api.calculate(leaseData);

// Upload contract
const { data, error } = await ifrs16Api.uploadContract(file);

// Chat with AI
const { data, error } = await chatApi.ask(companyId, question);
```

---

## 🎨 Design System

### Colors

```typescript
primary: '#0F172A'    // Deep navy
accent: '#6366F1'     // Indigo
success: '#10B981'    // Emerald
background: '#F8FAFC' // Off white
```

### Typography

- **Font**: Inter (Google Fonts)
- **Headings**: Bold, primary color
- **Body**: Regular, gray-600

### Components Style

- **Cards**: White background, subtle shadow, rounded-lg
- **Buttons**: Rounded-lg, transition-all, hover effects
- **Inputs**: Border-gray-300, focus:ring-accent
- **Charts**: Recharts with custom colors matching design

---

## 🔐 Authentication

### Supabase Setup

1. **Create Supabase Project**
   - Go to [https://supabase.com](https://supabase.com)
   - Click "New Project"
   - Set project name and password

2. **Enable Email Auth**
   - Go to Authentication > Providers
   - Enable Email provider
   - Save

3. **Create Test User**
   - Go to Authentication > Users
   - Click "Invite User"
   - Enter email/password

4. **Get API Keys**
   - Go to Settings > API
   - Copy Project URL and anon key
   - Add to `.env.local`

### Using Auth in Components

```typescript
import { useAuth } from '@/hooks/useAuth';

function MyComponent() {
  const { user, signIn, signOut, getCompanyId } = useAuth();
  
  // Check if authenticated
  if (!user) return <p>Please log in</p>;
  
  // Get company ID for API calls
  const companyId = getCompanyId();
}
```

---

## 💬 AI Chat Widget

The ChatWidget component is a floating chat interface that:

1. **Auto-loads on all dashboard pages**
2. **Connects to `/api/chat` RAG endpoint**
3. **Filters by company_id** (from Supabase user metadata)
4. **Shows loading states** while fetching
5. **Displays sources** used for answers
6. **Keeps last 5 messages** in state

### Usage

The widget is automatically included in `DashboardLayout.tsx`:

```typescript
<DashboardLayout>
  {children}
  {/* Chat widget auto-included */}
</DashboardLayout>
```

---

## 📊 Charts

Using **Recharts** for data visualization:

### Line Chart (Lease Liability Trend)
```typescript
<LineChart data={leaseDataTrend}>
  <Line dataKey="liability" stroke="#6366F1" />
</LineChart>
```

### Pie Chart (Leases by Type)
```typescript
<PieChart>
  <Pie data={leasesByType} dataKey="value" />
</PieChart>
```

### Area Chart (Amortization Schedule)
```typescript
<AreaChart data={chartData}>
  <Area dataKey="liability" fill="#6366F1" />
  <Area dataKey="interest" fill="#10B981" />
</AreaChart>
```

---

## 🔢 Indian Number Formatting

All monetary values are formatted in Indian number system:

```typescript
import { formatIndianCurrency, formatCrores, formatLakhs } from '@/lib/utils';

// ₹1,24,53,200
formatIndianCurrency(1245320);

// ₹12.45Cr
formatCrores(124532000);

// ₹12.45L
formatLakhs(1245320);
```

---

## 📱 Mobile Responsive

All pages are fully responsive:

- **Grid layouts** adjust to single column on mobile
- **Tables** scroll horizontally on small screens
- **Navigation** condenses on mobile (hidden menu)
- **Charts** resize responsively
- **Forms** stack vertically on mobile

---

## 🚀 Build & Deploy

### Development

```bash
npm run dev
```

### Production Build

```bash
npm run build
npm start
```

### Deploy to Vercel

1. Push code to GitHub
2. Go to [https://vercel.com](https://vercel.com)
3. Import repository
4. Add environment variables
5. Deploy

---

## 🧪 Testing

### Manual Testing Checklist

- [ ] Landing page loads and looks professional
- [ ] Login works with Supabase
- [ ] Dashboard shows KPIs and charts
- [ ] IFRS 16 manual entry calculates correctly
- [ ] Chat widget opens and sends messages
- [ ] Results display with formatted numbers
- [ ] Download Excel button works
- [ ] Mobile responsive on all pages
- [ ] Toast notifications appear on errors

---

## 🐛 Troubleshooting

### Issue: API calls failing

**Solution**: 
1. Check backend is running at `localhost:8000`
2. Check `NEXT_PUBLIC_API_URL` in `.env.local`
3. Open browser console for detailed errors

### Issue: Supabase auth not working

**Solution**:
1. Verify `NEXT_PUBLIC_SUPABASE_URL` and key in `.env.local`
2. Check Supabase project is active
3. Verify email auth is enabled in Supabase dashboard

### Issue: Charts not rendering

**Solution**:
1. Check if `recharts` is installed: `npm list recharts`
2. Verify data format matches chart requirements
3. Check browser console for errors

### Issue: Indian number formatting not working

**Solution**:
- Numbers must be passed as `number` type, not string
- Use `parseFloat()` or `parseInt()` if needed

---

## 📚 Key Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `next` | 16.x | React framework |
| `react` | 19.x | UI library |
| `tailwindcss` | 3.x | CSS framework |
| `@supabase/supabase-js` | Latest | Authentication |
| `recharts` | 2.x | Charts |
| `react-hot-toast` | Latest | Notifications |
| `lucide-react` | Latest | Icons |
| `date-fns` | Latest | Date formatting |

---

## 🎯 Next Steps

1. **Add real data**: Connect to actual Supabase tables for dashboard metrics
2. **Implement IFRS 15 & 9 calculations**: Wire up remaining endpoints
3. **Add file upload progress**: Show upload percentage
4. **Implement reports page**: List and filter all generated reports
5. **Add user settings**: Profile, company details, API keys
6. **Implement role-based access**: Admin vs user permissions
7. **Add export functionality**: CSV export for tables
8. **Implement search**: Global search across leases

---

## 💡 Tips

1. **Colors**: Stick to defined palette in `tailwind.config.ts`
2. **Spacing**: Use Tailwind spacing scale (4, 6, 8, 12, 16)
3. **Typography**: Use defined font sizes (text-sm, text-base, text-lg, etc.)
4. **Icons**: Always from `lucide-react` for consistency
5. **Forms**: Always include labels and placeholders
6. **Loading states**: Use `isLoading` prop on buttons
7. **Errors**: Show toast notifications for all errors
8. **Success**: Show toast for successful operations

---

## 📄 License

MIT License - see parent directory for details

---

## 🤝 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

---

**Built with ❤️ for Finance Teams**

© 2026 IFRS.ai. All rights reserved.
