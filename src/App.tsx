/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useMemo, useEffect } from 'react';
import { 
  Wine, 
  Calculator, 
  Tag, 
  Database, 
  CreditCard, 
  ShoppingBag, 
  TrendingUp, 
  Trash2, 
  History as HistoryIcon, 
  Download,
  AlertCircle,
  Package,
  Layers,
  BarChart3,
  Search,
  Sun,
  Moon,
  Home,
  Settings as SettingsIcon,
  PieChart,
  Grid3X3,
  LayoutDashboard,
  Box,
  ChartBar,
  LogOut,
  User,
  RefreshCw,
  Users,
  X
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Barcode from 'react-barcode';
import { onAuthStateChanged, User as FirebaseUser, signOut } from 'firebase/auth';
import { 
  collection, 
  query, 
  onSnapshot, 
  doc, 
  setDoc, 
  deleteDoc, 
  getDoc,
  writeBatch,
  orderBy
} from 'firebase/firestore';
import { auth, db, signInWithGoogle, handleFirestoreError, signInEmail, signUpEmail, getUserRole, UserRole } from './lib/firebase';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell
} from 'recharts';
import { 
  PurchaseType, 
  TaxCategory, 
  ProductIdentity, 
  CalculationResult,
  ILA_RATES,
  PurchaseValueType,
  RoundingMode,
  PURCHASE_MULTIPLIERS
} from './types';
import { calculateLiquorMetrics, formatCLP, smartRound } from './utils';

export default function App() {
  // --- States ---
  const [product, setProduct] = useState<ProductIdentity>({
    name: '',
    description: '',
    supplier: '',
    volume: '',
    origin: '',
    alcoholGrade: '',
    barcode: ''
  });

  const [costs, setCosts] = useState({
    netInvoice: 0,
    purchaseType: PurchaseType.UNIT,
    valueType: PurchaseValueType.NET,
    roundingMode: RoundingMode.NORMAL,
    marginPercent: 35,
    taxCategory: TaxCategory.DESTILADOS,
    previousOffer: 0
  });

  const [commissions, setCommissions] = useState({
    debit: 1.5,
    credit: 3.0,
    delivery: 25.0,
    deliveryName: 'PedidosYa',
    packagingCost: 0
  });

  const [settings, setSettings] = useState({
    storeName: 'Licorería Calc Pro',
    theme: 'dark' as 'light' | 'dark',
    currentView: 'calculator' as 'calculator' | 'database'
  });

  const [history, setHistory] = useState<(ProductIdentity & CalculationResult & { id: string; date: string })[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showUsers, setShowUsers] = useState(false);
  const [usersList, setUsersList] = useState<{ id: string; email: string; role: UserRole }[]>([]);
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [userRole, setUserRole] = useState<UserRole | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Email/Password states
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // --- Auth Effect ---
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        const isMasterAdmin = u.email?.toLowerCase() === 'jesus.israel.lima.canaza@gmail.com';
        
        // Optimistic UI update for master admin
        if (isMasterAdmin) {
          setUserRole('admin');
        }

        try {
          const role = await getUserRole(u.uid);
          
          if (role) {
            if (isMasterAdmin && role !== 'admin') {
              await setDoc(doc(db, 'roles', u.uid), { role: 'admin' }, { merge: true });
              setUserRole('admin');
            } else {
              setUserRole((role as UserRole));
            }
          } else {
            const newRole: UserRole = isMasterAdmin ? 'admin' : 'staff';
            try {
              await setDoc(doc(db, 'roles', u.uid), { role: newRole, email: u.email });
              setUserRole(newRole);
            } catch (err) {
              console.error("Error setting initial role:", err);
            }
          }
        } catch (err) {
          console.error("Role fetch error:", err);
          // Still keep admin role if master email even if fetch fails
          if (isMasterAdmin) setUserRole('admin');
        }
      } else {
        setUserRole(null);
        setShowUsers(false);
      }
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []); // Fixed: empty dependencies for auth listener

  // --- Firestore Sync for Settings & Commissions ---
  useEffect(() => {
    if (!user) return;

    const settingsRef = doc(db, 'users', user.uid, 'settings', 'config');
    
    // Load settings from Firestore
    const loadSettings = async () => {
      try {
        const snap = await getDoc(settingsRef);
        if (snap.exists()) {
          const data = snap.data();
          if (data.settings) setSettings(prev => ({ ...prev, ...data.settings }));
          if (data.commissions) setCommissions(prev => ({ ...prev, ...data.commissions }));
        }
      } catch (error) {
        console.error("Error loading settings:", error);
      }
    };

    loadSettings();
  }, [user]);

  // Sync settings/commissions back to Firestore when changed
  useEffect(() => {
    if (!user || !isAuthReady) return;

    const syncSettings = async () => {
      setIsSyncing(true);
      try {
        const settingsRef = doc(db, 'users', user.uid, 'settings', 'config');
        await setDoc(settingsRef, { settings, commissions }, { merge: true });
      } catch (err) {
        console.error("Sync error:", err);
      } finally {
        setIsSyncing(false);
      }
    };

    const timeoutId = setTimeout(syncSettings, 1000);
    return () => clearTimeout(timeoutId);
  }, [settings, commissions, user, isAuthReady]);

  // --- Firestore Sync for Products (History) ---
  useEffect(() => {
    if (!user) {
      setHistory([]);
      return;
    }

    const q = query(
      collection(db, 'users', user.uid, 'products'),
      orderBy('date', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snap) => {
      const docs = snap.docs.map(d => ({ ...d.data(), id: d.id })) as any;
      setHistory(docs);
    }, (error) => {
      handleFirestoreError(error, 'list', `users/${user.uid}/products`);
    });

    return () => unsubscribe();
  }, [user]);

  // --- Firestore Sync for Roles (Admin Only) ---
  useEffect(() => {
    if (!user || userRole !== 'admin' || !showUsers) return;

    const q = query(collection(db, 'roles'));
    const unsubscribe = onSnapshot(q, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() })) as any;
      setUsersList(list);
    }, (err) => {
      console.error("Error listing users:", err);
    });

    return () => unsubscribe();
  }, [user, userRole, showUsers]);

  const updateUserRole = async (targetUid: string, newRole: UserRole) => {
    if (userRole !== 'admin') return;
    try {
      await setDoc(doc(db, 'roles', targetUid), { role: newRole }, { merge: true });
    } catch (err) {
      console.error("Error updating role:", err);
      alert("Error al actualizar el rol. Verifica tus permisos.");
    }
  };

  const deleteUserRole = async (targetUid: string) => {
    if (userRole !== 'admin') return;
    if (targetUid === user?.uid) {
      alert("No puedes eliminarte a ti mismo.");
      return;
    }
    if (!confirm("¿Deseas eliminar este registro de rol? (No elimina la cuenta de Firebase, solo su acceso)")) return;
    
    try {
      await deleteDoc(doc(db, 'roles', targetUid));
    } catch (err) {
      console.error("Error deleting role:", err);
      alert("Error al eliminar el rol.");
    }
  };

  // --- Calculations ---
  const results = useMemo(() => {
    return calculateLiquorMetrics(
      costs.netInvoice,
      costs.purchaseType,
      costs.taxCategory,
      costs.marginPercent,
      costs.valueType,
      commissions
    );
  }, [costs, commissions]);

  // --- Handlers ---
  const handleProductChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setProduct(prev => ({ ...prev, [name]: value }));
  };

  const handleCostChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setCosts(prev => ({ 
      ...prev, 
      [name]: name === 'purchaseType' || name === 'taxCategory' || name === 'valueType' || name === 'roundingMode' ? value : parseFloat(value) || 0 
    }));
  };

  const handleCommissionChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setCommissions(prev => ({ 
      ...prev, 
      [name]: name === 'deliveryName' ? value : parseFloat(value) || 0 
    }));
  };

  const handleSettingsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setSettings(prev => ({ ...prev, [name]: value }));
  };

  const toggleTheme = () => {
    setSettings(prev => ({ ...prev, theme: prev.theme === 'dark' ? 'light' : 'dark' }));
  };

  const dashboardStats = useMemo(() => {
    return {
      totalItems: history.length,
      avgROI: history.length > 0 
        ? history.reduce((acc, curr) => acc + (curr.netProfitUnit / (curr.unitNet || 1)) * 100, 0) / history.length 
        : 0,
      totalInventoryVal: history.reduce((acc, curr) => acc + (curr.totalCost * curr.unitsPerPurchase), 0)
    };
  }, [history]);

  const marginChartData = useMemo(() => {
    const ranges = [
      { name: '<15%', min: 0, max: 0.15, count: 0, color: '#ef4444' },
      { name: '15-25%', min: 0.15, max: 0.25, count: 0, color: '#f59e0b' },
      { name: '25-35%', min: 0.25, max: 0.35, count: 0, color: '#3b82f6' },
      { name: '>35%', min: 0.35, max: 100, count: 0, color: '#10b981' },
    ];

    history.forEach(item => {
      const roi = item.netProfitUnit / (item.totalCost || 1);
      const range = ranges.find(r => roi >= r.min && roi < r.max);
      if (range) range.count++;
    });

    return ranges;
  }, [history]);

  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 8;

  const filteredHistory = useMemo(() => {
    return history.filter(item => 
      item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (item.supplier?.toLowerCase() || '').includes(searchTerm.toLowerCase()) ||
      (item.barcode?.toLowerCase() || '').includes(searchTerm.toLowerCase())
    );
  }, [history, searchTerm]);

  const paginatedHistory = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filteredHistory.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredHistory, currentPage]);

  const totalPages = Math.ceil(filteredHistory.length / itemsPerPage);

  const themeClasses = {
    sectionBg: settings.theme === 'dark' ? 'bg-slate-800/50 border-slate-700 shadow-sm' : 'bg-white border-slate-200 shadow-xl',
    inputBg: settings.theme === 'dark' ? 'bg-slate-900 border-slate-600' : 'bg-slate-50 border-slate-300',
    text: settings.theme === 'dark' ? 'text-slate-100' : 'text-slate-900',
    subText: settings.theme === 'dark' ? 'text-slate-500' : 'text-slate-400',
    accent: settings.theme === 'dark' ? 'text-blue-400' : 'text-blue-600',
    card: settings.theme === 'dark' ? 'bg-slate-800' : 'bg-white',
    inner: settings.theme === 'dark' ? 'bg-slate-900' : 'bg-slate-50'
  };

  const addToHistory = async () => {
    if (!product.name || costs.netInvoice === 0 || !user) return;
    setIsSyncing(true);
    try {
      const item = {
        ...product,
        ...results,
        unitsPerPurchase: PURCHASE_MULTIPLIERS[costs.purchaseType],
        date: new Date().toLocaleDateString() + ' ' + new Date().toLocaleTimeString(),
        ownerId: user.uid
      };
      
      const productsRef = collection(db, 'users', user.uid, 'products');
      await setDoc(doc(productsRef), item);
    } catch (error) {
      handleFirestoreError(error, 'create', `users/${user.uid}/products`);
    } finally {
      setIsSyncing(false);
    }
  };

  const clearHistory = async () => {
    if (!user) return;
    if (!confirm('¿Estás seguro de que deseas eliminar TODOS los productos del historial?')) return;
    
    setIsSyncing(true);
    try {
      const batch = writeBatch(db);
      history.forEach(item => {
        batch.delete(doc(db, 'users', user.uid, 'products', item.id));
      });
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, 'write', `users/${user.uid}/products`);
    } finally {
      setIsSyncing(false);
    }
  };

  const deleteProduct = async (id: string) => {
    if (!user) return;
    setIsSyncing(true);
    try {
      await deleteDoc(doc(db, 'users', user.uid, 'products', id));
    } catch (error) {
      handleFirestoreError(error, 'delete', `users/${user.uid}/products/${id}`);
    } finally {
      setIsSyncing(false);
    }
  };

  const downloadCSV = () => {
    if (history.length === 0) return;
    const headers = ['Nombre', 'Proveedor', 'Costo Unit.', 'IVA', 'ILA', 'Precio Mostrador', 'Ganancia Unid.', 'Fecha'];
    const rows = history.map(item => [
      item.name,
      item.supplier || 'N/A',
      item.unitNet,
      item.ivaAmount,
      item.ilaAmount,
      item.counterPrice,
      item.netProfitUnit,
      item.date
    ]);
    const csvContent = [headers, ...rows].map(e => e.join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `calc_pro_historial_${new Date().toISOString().split('T')[0]}.csv`);
    link.click();
  };

  if (!isAuthReady) {
    return (
      <div className={`min-h-screen flex items-center justify-center ${settings.theme === 'dark' ? 'bg-slate-950' : 'bg-slate-50'}`}>
        <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  if (!user) {
    const handleEmailAuth = async (e: React.FormEvent) => {
      e.preventDefault();
      setAuthError(null);
      setIsLoggingIn(true);
      try {
        if (isSignUp) {
          await signUpEmail(email, password);
        } else {
          await signInEmail(email, password);
        }
      } catch (err: any) {
        setAuthError(err.message || 'Error de autenticación');
      } finally {
        setIsLoggingIn(false);
      }
    };

    return (
      <div translate="no" className={`min-h-screen flex items-center justify-center p-6 ${settings.theme === 'dark' ? 'bg-slate-950' : 'bg-slate-50'}`}>
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className={`max-w-md w-full p-8 rounded-2xl border ${settings.theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-2xl'}`}
        >
          <div className="flex flex-col items-center text-center">
            <div className="p-4 rounded-2xl bg-blue-500/10 text-blue-500 mb-6">
               <Wine className="w-12 h-12" />
            </div>
            <h1 className="text-2xl font-black text-blue-500 uppercase tracking-tighter mb-2">CALC PRO v2.5</h1>
            <p className="text-slate-500 text-xs mb-8 uppercase tracking-widest font-bold">Gestión de Costos con Roles</p>
            
            <form onSubmit={handleEmailAuth} className="w-full space-y-4 mb-6 text-left">
              <div>
                <label className="text-[10px] text-slate-500 uppercase font-black mb-1 block">Correo Electrónico</label>
                <input 
                  type="email" 
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={`w-full ${themeClasses.inputBg} rounded-xl px-4 py-3 text-sm text-white font-medium placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all`}
                  placeholder="ejemplo@correo.com"
                  required
                />
              </div>
              <div>
                <label className="text-[10px] text-slate-500 uppercase font-black mb-1 block">Contraseña</label>
                <input 
                  type="password" 
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={`w-full ${themeClasses.inputBg} rounded-xl px-4 py-3 text-sm text-white font-medium placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all`}
                  placeholder="••••••••"
                  required
                />
              </div>

              {authError && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-[10px] text-red-500 font-bold flex items-center gap-2">
                  <AlertCircle className="w-4 h-4" /> {authError}
                </div>
              )}

              <button 
                type="submit"
                disabled={isLoggingIn}
                className="w-full py-3 bg-blue-500 text-white font-black rounded-xl hover:bg-blue-600 transition-all shadow-lg flex items-center justify-center gap-2 uppercase tracking-widest text-xs"
              >
                {isLoggingIn ? <RefreshCw className="w-4 h-4 animate-spin" /> : (isSignUp ? 'Crear Cuenta' : 'Ingresar')}
              </button>
            </form>

            <div className="flex items-center gap-3 w-full mb-6">
              <div className="h-px flex-1 bg-slate-800"></div>
              <span className="text-[9px] text-slate-600 font-black uppercase">O ingresa con</span>
              <div className="h-px flex-1 bg-slate-800"></div>
            </div>

            <button 
              onClick={signInWithGoogle}
              className="w-full flex items-center justify-center gap-3 py-3 bg-white text-slate-900 font-bold rounded-xl hover:bg-slate-100 transition-all border border-slate-200 shadow-xl"
            >
              <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-5 h-5" alt="Google" referrerPolicy="no-referrer" />
              Google
            </button>
            
            <button 
              onClick={() => setIsSignUp(!isSignUp)}
              className="mt-6 text-[10px] text-blue-500 uppercase font-black tracking-widest hover:underline"
            >
              {isSignUp ? '¿Ya tienes cuenta? Ingresa' : '¿No tienes cuenta? Regístrate'}
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div translate="no" className={`min-h-screen transition-colors duration-300 ${settings.theme === 'dark' ? 'bg-slate-900 text-slate-100' : 'bg-slate-50 text-slate-900'} font-sans p-0 flex flex-col`}>
      {/* Header Section */}
      <header className={`px-6 py-4 flex justify-between items-center border-b sticky top-0 z-10 backdrop-blur no-print ${settings.theme === 'dark' ? 'border-slate-700 bg-slate-900/80' : 'border-slate-200 bg-white/80'}`}>
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${settings.theme === 'dark' ? 'bg-blue-500/10 text-blue-400' : 'bg-blue-100 text-blue-600'}`}>
            <Wine className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-blue-400 uppercase">
              {settings.storeName}
            </h1>
            <p className="text-[9px] text-slate-400 uppercase tracking-widest font-black flex items-center gap-1 mt-[-2px]">
              CALC PRO <span className="text-slate-500 font-light">| v2.2-STABLE</span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <nav className={`flex p-1 rounded-xl mr-4 ${settings.theme === 'dark' ? 'bg-slate-800/50' : 'bg-slate-100'}`}>
            <button 
              onClick={() => setSettings(p => ({ ...p, currentView: 'calculator' }))}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${settings.currentView === 'calculator' ? (settings.theme === 'dark' ? 'bg-blue-500 text-white shadow-lg' : 'bg-blue-600 text-white shadow-md') : 'text-slate-500 hover:text-blue-400'}`}
            >
              <Calculator className="w-4 h-4" /> Calculadora
            </button>
            <button 
              onClick={() => setSettings(p => ({ ...p, currentView: 'database' }))}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${settings.currentView === 'database' ? (settings.theme === 'dark' ? 'bg-blue-500 text-white shadow-lg' : 'bg-blue-600 text-white shadow-md') : 'text-slate-500 hover:text-blue-400'}`}
            >
              <Database className="w-4 h-4" /> Inventario
            </button>
          </nav>

          <button 
            onClick={toggleTheme}
            className={`p-2 rounded-lg transition-all ${settings.theme === 'dark' ? 'bg-slate-800 text-amber-400 hover:bg-slate-700' : 'bg-slate-100 text-blue-600 hover:bg-slate-200'}`}
          >
            {settings.theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          </button>
          
          <div className={`${settings.theme === 'dark' ? 'bg-slate-800 border-slate-700' : 'bg-slate-100 border-slate-200'} px-4 py-2 rounded border hidden sm:block`}>
            <span className="text-[10px] text-slate-500 block uppercase font-bold tracking-tighter">Fecha Proceso</span>
            <span className={`text-sm font-mono italic ${settings.theme === 'dark' ? 'text-slate-300' : 'text-slate-600'}`}>{new Date().toISOString().split('T')[0]}</span>
          </div>
          
          <button 
            onClick={() => setShowHistory(!showHistory)}
            className={`flex items-center gap-2 px-4 py-2 rounded border transition-colors text-xs font-bold uppercase tracking-wider ${settings.theme === 'dark' ? 'border-slate-700 hover:bg-slate-800' : 'border-slate-200 hover:bg-slate-50'}`}
          >
            <HistoryIcon className="w-4 h-4 text-blue-400" />
            <span className="hidden md:inline">Dashboard</span>
            <span className="bg-blue-600 text-white px-1.5 rounded text-[9px]">{history.length}</span>
          </button>
          <button 
            onClick={addToHistory}
            disabled={!product.name || costs.netInvoice === 0}
            className="bg-blue-600 px-6 py-2 rounded font-bold text-xs uppercase tracking-widest flex items-center cursor-pointer hover:bg-blue-500 transition-all shadow-lg shadow-blue-900/20 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            GUARDAR
          </button>
          <div className="flex items-center gap-3 ml-4 pl-4 border-l border-slate-700/50">
            {isSyncing && (
              <RefreshCw className="w-3.5 h-3.5 text-blue-500 animate-spin mr-2" />
            )}
            <div className="flex items-center gap-2 group relative">
              <div className={`w-8 h-8 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center overflow-hidden`}>
                {user.photoURL ? (
                  <img src={user.photoURL} alt={user.displayName || ''} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                ) : (
                  <User className="w-4 h-4 text-slate-500" />
                )}
              </div>
              <div className="hidden lg:flex flex-col items-start px-2">
                <span className="text-[9px] font-black text-slate-200 uppercase truncate max-w-[100px] leading-none">
                  {user.displayName || user.email?.split('@')[0] || 'Usuario'}
                </span>
                <span className={`text-[7px] font-bold ${userRole === 'admin' ? 'text-amber-500' : 'text-emerald-500'} uppercase tracking-widest mt-0.5`}>
                  {user.email?.toLowerCase() === 'jesus.israel.lima.canaza@gmail.com' ? 'ADMINISTRADOR' : (userRole?.toUpperCase() || 'USUARIO')}
                </span>
              </div>
              {userRole === 'admin' && (
                <button 
                  onClick={() => setShowUsers(!showUsers)}
                  className={`p-2 rounded-lg transition-all ${showUsers ? 'bg-amber-500/20 text-amber-500' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}
                  title="Gestión de Usuarios"
                >
                  <Users className="w-4 h-4" />
                </button>
              )}
              <button 
                onClick={() => signOut(auth)}
                className="p-2 rounded-lg hover:bg-red-500/10 text-slate-500 hover:text-red-500 transition-all"
                title="Cerrar Sesión"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Grid */}
      <main className={`max-w-screen-2xl mx-auto w-full p-6 flex-1 no-print ${settings.theme === 'light' ? 'opacity-95' : ''}`}>
        
        {showUsers && userRole === 'admin' ? (
          <div className="flex-1 animate-in slide-in-from-right duration-500">
             <div className={`${themeClasses.sectionBg} rounded-2xl border p-8 max-w-4xl mx-auto shadow-2xl`}>
                <div className="flex justify-between items-center mb-8">
                  <div>
                    <h2 className="text-2xl font-black text-blue-500 uppercase tracking-tighter">Panel de Gestión de Usuarios</h2>
                    <p className="text-slate-500 text-xs uppercase font-bold tracking-widest mt-1">Control de Roles y Accesos</p>
                  </div>
                  <button onClick={() => setShowUsers(false)} className="p-2 hover:bg-slate-800 rounded-lg text-slate-500">
                    <X className="w-6 h-6" />
                  </button>
                </div>

                <div className="overflow-hidden rounded-xl border border-slate-800/50 bg-slate-900/30">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="bg-slate-900/50 text-[10px] text-slate-500 uppercase font-black tracking-widest">
                        <th className="px-6 py-4">Usuario / Email</th>
                        <th className="px-6 py-4">ID de Sistema</th>
                        <th className="px-6 py-4">Rol Asignado</th>
                        <th className="px-6 py-4 text-center">Acciones</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/50">
                      {usersList.map((u) => (
                        <tr key={u.id} className="hover:bg-slate-800/20 transition-colors">
                          <td className="px-6 py-4 leading-none">
                            <div className="text-xs font-bold text-slate-200">{u.email}</div>
                          </td>
                          <td className="px-6 py-4">
                            <span className="text-[9px] font-mono text-slate-600">{u.id}</span>
                          </td>
                          <td className="px-6 py-4">
                            <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-tighter ${u.id === user.uid ? 'bg-blue-500/20 text-blue-400' : u.role === 'admin' ? 'bg-amber-500/10 text-amber-500' : 'bg-emerald-500/10 text-emerald-500'}`}>
                              {u.email?.toLowerCase() === 'jesus.israel.lima.canaza@gmail.com' ? 'ADMIN MAESTRO' : u.role}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex justify-center gap-2 items-center">
                              {u.email?.toLowerCase() === 'jesus.israel.lima.canaza@gmail.com' ? (
                                <span className="text-[9px] font-black text-blue-500/50 uppercase italic">Nivel Root</span>
                              ) : u.role === 'staff' ? (
                                <button 
                                  onClick={() => updateUserRole(u.id, 'admin')}
                                  className="px-3 py-1 bg-amber-500/10 text-amber-500 text-[9px] font-black rounded uppercase hover:bg-amber-500 hover:text-white transition-all"
                                >
                                  Hacer Admin
                                </button>
                              ) : (
                                <button 
                                  onClick={() => updateUserRole(u.id, 'staff')}
                                  className="px-3 py-1 bg-emerald-500/10 text-emerald-500 text-[9px] font-black rounded uppercase hover:bg-emerald-500 hover:text-white transition-all"
                                  disabled={u.id === user.uid}
                                >
                                  Hacer Encargado
                                </button>
                              )}

                              {u.id !== user.uid && (
                                <button 
                                  onClick={() => deleteUserRole(u.id)}
                                  className="p-1.5 text-rose-500 hover:bg-rose-500/10 rounded-lg transition-all"
                                  title="Eliminar Registro de Rol"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                
                <div className="mt-8 p-4 bg-blue-500/5 border border-blue-500/10 rounded-xl">
                   <div className="flex gap-3">
                     <AlertCircle className="w-5 h-5 text-blue-500 shrink-0" />
                     <p className="text-[10px] text-slate-400 font-bold uppercase leading-relaxed">
                       Nota: Los cambios de rol se aplican instantáneamente en los permisos de base de datos. Los usuarios podrían necesitar refrescar la aplicación para ver cambios visuales.
                     </p>
                   </div>
                </div>
             </div>
          </div>
        ) : settings.currentView === 'calculator' ? (
          <div className="grid grid-cols-12 gap-6">
            {/* Left: Identity & Costing (Input Area) */}
            <div className="col-span-12 lg:col-span-4 space-y-6">
          <section className={`${themeClasses.sectionBg} p-6 rounded-xl border`}>
            <h2 className={`text-xs font-bold ${themeClasses.accent} mb-6 uppercase tracking-widest flex items-center gap-2`}>
              <Tag className="w-4 h-4" />
              Identidad del Producto
            </h2>
            <div className="space-y-4">
              <div>
                <label className="text-[10px] text-slate-500 uppercase font-bold mb-1 block">Nombre del Producto</label>
                <input 
                  type="text" 
                  name="name"
                  value={product.name}
                  onChange={handleProductChange}
                  placeholder="Ej: Johnnie Walker Black Label 750cc"
                  className={`w-full ${themeClasses.inner} border ${settings.theme === 'dark' ? 'border-slate-600' : 'border-slate-300'} rounded px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500 transition-colors placeholder:text-slate-400`}
                />
              </div>
              <div>
                <label className="text-[10px] text-slate-500 uppercase font-bold mb-1 block">Proveedor / Distribuidor</label>
                <input 
                  type="text" 
                  name="supplier"
                  value={product.supplier}
                  onChange={handleProductChange}
                  placeholder="Ej: CCU, Embonor, Distribuidora X"
                  className={`w-full ${themeClasses.inner} border ${settings.theme === 'dark' ? 'border-slate-600' : 'border-slate-300'} rounded px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500 transition-colors placeholder:text-slate-400`}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] text-slate-500 uppercase font-bold mb-1 block">Volumen (cc/L)</label>
                  <input 
                    type="text" 
                    name="volume"
                    value={product.volume}
                    onChange={handleProductChange}
                    placeholder="750cc"
                    className={`w-full ${themeClasses.inner} border ${settings.theme === 'dark' ? 'border-slate-600' : 'border-slate-300'} rounded px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500 transition-colors`}
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-500 uppercase font-bold mb-1 block">Grado Alc.</label>
                  <input 
                    type="text" 
                    name="alcoholGrade"
                    value={product.alcoholGrade}
                    onChange={handleProductChange}
                    placeholder="40%"
                    className={`w-full ${themeClasses.inner} border ${settings.theme === 'dark' ? 'border-slate-600' : 'border-slate-300'} rounded px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500 transition-colors`}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] text-slate-500 uppercase font-bold mb-1 block">Origen</label>
                  <input 
                    type="text" 
                    name="origin"
                    value={product.origin}
                    onChange={handleProductChange}
                    placeholder="Escocia"
                    className={`w-full ${themeClasses.inner} border ${settings.theme === 'dark' ? 'border-slate-600' : 'border-slate-300'} rounded px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500 transition-colors`}
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-500 uppercase font-bold mb-1 block">EAN/Barcode</label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-600" />
                    <input 
                      type="text" 
                      name="barcode"
                      value={product.barcode}
                      onChange={handleProductChange}
                      placeholder="SCANNER..."
                      className={`w-full ${themeClasses.inner} border ${settings.theme === 'dark' ? 'border-slate-600' : 'border-slate-300'} rounded pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:border-blue-500 transition-colors font-mono`}
                    />
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className={`${themeClasses.sectionBg} p-6 rounded-xl border`}>
            <h2 className="text-xs font-bold text-amber-500 mb-6 uppercase tracking-widest flex items-center gap-2">
              <Calculator className="w-4 h-4" />
              Parámetros de Compra
            </h2>
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] text-slate-500 uppercase font-bold mb-1 block">Tipo de Ingreso</label>
                  <select 
                    name="valueType"
                    value={costs.valueType}
                    onChange={handleCostChange}
                    className={`w-full ${themeClasses.inner} border ${settings.theme === 'dark' ? 'border-slate-600' : 'border-slate-300'} rounded px-2 py-2.5 text-sm focus:outline-none focus:border-blue-500 transition-colors appearance-none cursor-pointer`}
                  >
                    {Object.values(PurchaseValueType).map(type => (
                      <option key={type} value={type}>{type}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-slate-500 uppercase font-bold mb-1 block">Formato Compra</label>
                  <select 
                    name="purchaseType"
                    value={costs.purchaseType}
                    onChange={handleCostChange}
                    className={`w-full ${themeClasses.inner} border ${settings.theme === 'dark' ? 'border-slate-600' : 'border-slate-300'} rounded px-2 py-2.5 text-sm focus:outline-none focus:border-blue-500 transition-colors appearance-none cursor-pointer`}
                  >
                    {Object.values(PurchaseType).map(type => (
                      <option key={type} value={type}>{type}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                  <label className="text-[10px] text-slate-500 uppercase font-bold mb-1 block">Valor {costs.valueType === PurchaseValueType.NET ? 'Neto Factura' : 'Bruto Total'}</label>
                  <input 
                    type="number" 
                    name="netInvoice"
                    value={costs.netInvoice || ''}
                    onChange={handleCostChange}
                    placeholder="$ 0"
                    className={`w-full ${themeClasses.inner} border ${settings.theme === 'dark' ? 'border-slate-600' : 'border-slate-300'} rounded px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500 transition-colors font-mono text-amber-500 font-bold`}
                  />
                  <p className="text-[9px] text-slate-500 mt-1 italic leading-tight">
                    {costs.valueType === PurchaseValueType.GROSS 
                      ? 'Si ingresas "1000", la calculadora ignorará la suma de impuestos adicionales sobre el costo.' 
                      : 'Se sumarán IVA e ILA sobre este valor para determinar el costo total.'}
                  </p>
              </div>
              <div>
                  <label className="text-[10px] text-slate-500 uppercase font-bold mb-1 block">Impuestos (Categoría ILA)</label>
                  <select 
                    name="taxCategory"
                    value={costs.taxCategory}
                    onChange={handleCostChange}
                    className={`w-full ${themeClasses.inner} border ${settings.theme === 'dark' ? 'border-slate-600' : 'border-slate-300'} rounded px-2 py-2.5 text-sm focus:outline-none focus:border-blue-500 transition-colors appearance-none cursor-pointer`}
                  >
                    {Object.values(TaxCategory).map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] text-slate-500 uppercase font-bold mb-1 block">Margen Objetivo (%)</label>
                  <div className="relative">
                    <TrendingUp className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-600" />
                    <input 
                      type="number" 
                      name="marginPercent"
                      value={costs.marginPercent || ''}
                      onChange={handleCostChange}
                      className={`w-full ${themeClasses.inner} border ${settings.theme === 'dark' ? 'border-slate-600' : 'border-slate-300'} rounded px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500 transition-colors font-bold`}
                    />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] text-slate-500 uppercase font-bold mb-1 block">Modo de Redondeo</label>
                  <select 
                    name="roundingMode"
                    value={costs.roundingMode}
                    onChange={handleCostChange}
                    className={`w-full ${themeClasses.inner} border ${settings.theme === 'dark' ? 'border-slate-600' : 'border-slate-300'} rounded px-2 py-2.5 text-xs focus:outline-none focus:border-blue-500 transition-colors appearance-none cursor-pointer font-bold text-blue-500`}
                  >
                    {Object.values(RoundingMode).map(mode => (
                      <option key={mode} value={mode}>{mode}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="pt-2 border-t border-dashed border-slate-700/50">
                  <label className="text-[10px] text-amber-500 uppercase font-black mb-1 block flex items-center gap-2">
                    <ShoppingBag className="w-3 h-3" /> Costo Bolsa / Empaque (Apps)
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-xs">$</span>
                    <input 
                      type="number" 
                      name="packagingCost"
                      value={commissions.packagingCost || ''}
                      onChange={handleCommissionChange}
                      placeholder="0"
                      className={`w-full ${themeClasses.inner} border ${settings.theme === 'dark' ? 'border-slate-600' : 'border-slate-300'} rounded pl-7 pr-3 py-2.5 text-sm focus:outline-none focus:border-blue-500 transition-colors font-mono text-amber-500`}
                    />
                  </div>
                  <p className="text-[8px] text-slate-500 mt-1 italic leading-tight">
                    Este monto se carga al precio final del App para cubrir el insumo.
                  </p>
              </div>
            </div>
          </section>
        </div>

        {/* Center: Detailed Breakdown */}
        <div className="col-span-12 lg:col-span-4 space-y-6">
          <section className={`${themeClasses.sectionBg} p-6 rounded-xl border h-full flex flex-col`}>
            <h2 className="text-xs font-bold text-slate-400 mb-8 uppercase tracking-widest flex items-center gap-2">
              <BarChart3 className="w-4 h-4" />
              Desglose Técnico de Costos
            </h2>
            
            <div className={`space-y-5 font-mono flex-1`}>
              <div className={`flex justify-between border-b ${settings.theme === 'dark' ? 'border-slate-700' : 'border-slate-100'} pb-3`}>
                <span className="text-sm text-slate-500 italic">Neto Unitario:</span>
                <span className={`text-sm ${themeClasses.text} font-bold`}>{formatCLP(results.unitNet)}</span>
              </div>
              <div className={`flex justify-between border-b ${settings.theme === 'dark' ? 'border-slate-700' : 'border-slate-100'} pb-3`}>
                <span className="text-sm text-slate-500 italic">IVA (19%):</span>
                <span className={`text-sm ${themeClasses.text}`}>{formatCLP(results.ivaAmount)}</span>
              </div>
              <div className={`flex justify-between border-b ${settings.theme === 'dark' ? 'border-slate-700' : 'border-slate-100'} pb-3`}>
                <span className="text-sm text-slate-500 italic font-bold">ILA ({(ILA_RATES[costs.taxCategory] * 100).toFixed(1)}%):</span>
                <span className="text-sm text-orange-500">{formatCLP(results.ilaAmount)}</span>
              </div>
              <div className={`flex justify-between ${themeClasses.inner} p-4 rounded mt-6 border ${settings.theme === 'dark' ? 'border-blue-900 shadow-inner' : 'border-blue-100'}`}>
                <span className="text-sm text-blue-500 font-bold uppercase tracking-tighter">Costo Total Bruto:</span>
                <span className={`text-lg ${themeClasses.text} font-black`}>{formatCLP(results.totalCost)}</span>
              </div>

              <div className="mt-10">
                <div className="flex justify-between items-center mb-5">
                  <h3 className={`text-[10px] ${themeClasses.subText} uppercase font-black tracking-widest border-l-2 ${settings.theme === 'dark' ? 'border-slate-600' : 'border-slate-300'} pl-2`}>Comisiones de Canal</h3>
                  {userRole === 'admin' && (
                    <button 
                      onClick={() => setShowHistory(true)}
                      className="text-[9px] text-blue-500 font-bold hover:underline"
                    >
                      EDITAR COMISIONES
                    </button>
                  )}
                </div>
                <div className="space-y-4">
                  <div className="flex justify-between text-xs items-center">
                    <div className="flex items-center gap-2">
                      <CreditCard className="w-3.5 h-3.5 text-slate-400" />
                      <span className="text-slate-500">Transbank (Débito {commissions.debit}%)</span>
                    </div>
                    <span className={`${themeClasses.text} font-bold`}>{formatCLP(results.counterPrice * (commissions.debit / 100))}</span>
                  </div>
                  <div className="flex justify-between text-xs items-center">
                    <div className="flex items-center gap-2">
                      <CreditCard className="w-3.5 h-3.5 text-blue-500" />
                      <span className="text-slate-500">Transbank (Crédito {commissions.credit}%)</span>
                    </div>
                    <span className={`${themeClasses.text} font-bold`}>{formatCLP(results.counterPrice * (commissions.credit / 100))}</span>
                  </div>
                  <div className="flex justify-between text-xs items-center">
                    <div className="flex items-center gap-2">
                      <ShoppingBag className="w-3.5 h-3.5 text-red-500" />
                      <span className="text-slate-500">{commissions.deliveryName} ({commissions.delivery}%)</span>
                    </div>
                    <div className="text-right">
                       <span className={`${themeClasses.text} font-bold block`}>{formatCLP(results.pedidosYaPrice * (commissions.delivery / 100))}</span>
                       {commissions.packagingCost > 0 && (
                         <span className="text-[8px] text-red-400 font-bold uppercase tracking-tighter">+ {formatCLP(commissions.packagingCost)} EMPAQUE</span>
                       )}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className={`mt-8 p-4 ${themeClasses.inner} rounded-lg border ${settings.theme === 'dark' ? 'border-slate-700/50' : 'border-slate-200'} text-[10px] text-slate-500 leading-relaxed italic`}>
              * El margen protegido en {commissions.deliveryName} se calcula incrementando el precio base para cubrir la comisión del {commissions.delivery}% sin afectar la utilidad neta esperada.
            </div>
          </section>
        </div>

        {/* Right: Final Pricing Results */}
        <div className="col-span-12 lg:col-span-4 space-y-6">
          <section className="bg-blue-600 p-8 rounded-xl shadow-2xl shadow-blue-900/40 relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:scale-110 transition-transform">
              <Wine className="w-32 h-32 rotate-12" />
            </div>
            <label className="text-[10px] text-blue-200 uppercase font-black block mb-2 tracking-widest">Precio Mostrador (Sugerido)</label>
            <div className="flex items-baseline gap-4">
              <div className="text-5xl font-black text-white tracking-tighter drop-shadow-md">
                {formatCLP(smartRound(results.counterPrice, costs.roundingMode))}
              </div>
              {costs.previousOffer > 0 && (
                <div className="flex flex-col">
                  <span className="text-[10px] text-blue-300 line-through opacity-70 underline decoration-red-400">Err: {formatCLP(costs.previousOffer)}</span>
                  <span className={`text-[10px] font-bold px-1.5 rounded py-0.5 mt-1 ${smartRound(results.counterPrice, costs.roundingMode) < costs.previousOffer ? 'bg-emerald-500/30 text-emerald-300' : 'bg-red-500/30 text-red-300'}`}>
                    {smartRound(results.counterPrice, costs.roundingMode) < costs.previousOffer ? 'BAJA' : 'ALZA'}
                  </span>
                </div>
              )}
            </div>
            <p className="text-[10px] text-blue-100 mt-4 italic font-medium">Incluye IVA + ILA + Margen {costs.marginPercent}%</p>
          </section>

          <div className="grid grid-cols-2 gap-4">
            <div className={`${themeClasses.sectionBg} p-5 rounded-xl border`}>
              <label className="text-[10px] text-emerald-500 uppercase font-black block mb-2 tracking-widest underline decoration-emerald-500/50 underline-offset-4">Neto al Banco (Débito)</label>
              <div className={`text-3xl font-black ${settings.theme === 'dark' ? 'text-emerald-100' : 'text-emerald-700'} tracking-tighter font-mono`}>
                {formatCLP(results.debitPrice)}
              </div>
              <p className={`text-[9px] ${settings.theme === 'dark' ? 'text-emerald-500/80' : 'text-emerald-600'} mt-2 uppercase font-bold tracking-tighter`}>Venta - {commissions.debit}% comisión</p>
            </div>
            
            <div className={`${themeClasses.sectionBg} p-5 rounded-xl border`}>
              <label className="text-[10px] text-amber-500 uppercase font-black block mb-2 tracking-widest underline decoration-amber-500/50 underline-offset-4">Neto al Banco (Crédito)</label>
              <div className={`text-3xl font-black ${settings.theme === 'dark' ? 'text-amber-100' : 'text-amber-700'} tracking-tighter font-mono`}>
                {formatCLP(results.creditPrice)}
              </div>
              <p className={`text-[9px] ${settings.theme === 'dark' ? 'text-amber-500/80' : 'text-amber-600'} mt-2 uppercase font-bold tracking-tighter`}>Venta - {commissions.credit}% comisión</p>
            </div>
          </div>

          <div className={`${settings.theme === 'dark' ? 'bg-red-900/10' : 'bg-red-50'} p-5 rounded-xl border ${settings.theme === 'dark' ? 'border-red-500/40' : 'border-red-200'} backdrop-blur-sm`}>
            <label className="text-[10px] text-red-500 uppercase font-black block mb-2 tracking-widest underline decoration-red-500/50 underline-offset-4">Precio {commissions.deliveryName} (App)</label>
            <div className={`text-3xl font-black ${settings.theme === 'dark' ? 'text-red-100' : 'text-red-700'} tracking-tighter font-mono`}>
              {formatCLP(smartRound(results.pedidosYaPrice, costs.roundingMode))}
            </div>
            <p className="text-[9px] text-red-500/80 mt-2 uppercase font-bold tracking-tighter flex items-center gap-1">
              <AlertCircle className="w-3 h-3" /> Margen protegido tras comisión {commissions.delivery}%
            </p>
          </div>

          <div className={`${themeClasses.sectionBg} p-5 rounded-xl border`}>
            <label className={`text-[10px] ${themeClasses.subText} uppercase font-black block mb-4 tracking-widest`}>Precios por Pack</label>
            <div className="grid grid-cols-2 gap-3 font-mono">
              <div className={`${themeClasses.inner} p-3 rounded border ${settings.theme === 'dark' ? 'border-slate-700' : 'border-slate-200'}`}>
                <span className="text-[9px] text-slate-500 block uppercase">Pack x4</span>
                <span className={`text-sm font-bold ${themeClasses.text}`}>{formatCLP(smartRound(results.packPrices.pack4, costs.roundingMode))}</span>
              </div>
              <div className={`${themeClasses.inner} p-3 rounded border ${settings.theme === 'dark' ? 'border-slate-700' : 'border-slate-200'}`}>
                <span className="text-[9px] text-slate-500 block uppercase">Pack x6</span>
                <span className={`text-sm font-bold ${themeClasses.text}`}>{formatCLP(smartRound(results.packPrices.pack6, costs.roundingMode))}</span>
              </div>
              <div className={`${themeClasses.inner} p-3 rounded border ${settings.theme === 'dark' ? 'border-slate-700' : 'border-slate-200'}`}>
                <span className="text-[9px] text-slate-500 block uppercase">Base x12</span>
                <span className={`text-sm font-bold ${themeClasses.text}`}>{formatCLP(smartRound(results.packPrices.box12, costs.roundingMode))}</span>
              </div>
              <div className={`${themeClasses.inner} p-3 rounded border ${settings.theme === 'dark' ? 'border-slate-700' : 'border-slate-200'}`}>
                <span className="text-[9px] text-slate-500 block uppercase">Caja x24</span>
                <span className={`text-sm font-bold ${themeClasses.text}`}>{formatCLP(smartRound(results.packPrices.box24, costs.roundingMode))}</span>
              </div>
            </div>
          </div>

          <div className={`${themeClasses.sectionBg} p-6 rounded-xl border flex flex-col items-center`}>
            <label className={`text-[10px] ${themeClasses.subText} uppercase font-black mb-4 tracking-widest block w-full text-center`}>Previsualización Etiqueta (8x4 cm)</label>
          <div 
            id="printable-label" 
            style={{ width: '302.4px', height: '151.2px' }}
            className="bg-white border-2 border-slate-900 p-4 flex flex-col justify-between relative overflow-hidden"
          >
            <div>
              <h3 className="text-black font-black text-lg uppercase leading-tight truncate">{product.name || 'NOMBRE PRODUCTO'}</h3>
              <div className="flex justify-between items-start">
                <p className="text-gray-500 text-[10px] uppercase font-bold">{product.volume || 'VOL'} | {product.alcoholGrade || 'GRAD'}</p>
              </div>
            </div>
            
            <div className="flex justify-between items-end gap-2">
              <div className="text-black flex-1">
                <p className="text-[9px] font-bold uppercase mb-[-4px]">Precio Total</p>
                <div className="flex items-baseline gap-1">
                  <p className="text-4xl font-black tracking-tighter">{formatCLP(smartRound(results.counterPrice, costs.roundingMode))}</p>
                </div>
              </div>
              <div className="w-32 flex flex-col items-end shrink-0 overflow-hidden">
                <Barcode 
                  value={product.barcode || '123456789012'} 
                  width={1.2}
                  height={35}
                  margin={0}
                  displayValue={false}
                />
                <p className="text-[7px] font-mono text-black truncate tracking-tighter font-bold uppercase mt-1">{product.barcode || 'NO CODE'}</p>
              </div>
            </div>
          </div>
          <button 
            onClick={() => window.print()}
            className="mt-4 w-full py-2 bg-slate-900 text-white rounded text-[10px] font-black uppercase tracking-widest hover:bg-black transition-all flex items-center justify-center gap-2"
          >
            <Download className="w-3.5 h-3.5" /> Imprimir Etiqueta (8x4)
          </button>
          </div>

          <div className={`p-8 rounded-xl border shadow-inner transition-colors duration-500 ${results.totalCost > 0 && (results.netProfitUnit / results.totalCost) < 0.15 ? 'bg-red-900/40 border-red-500/40' : 'bg-emerald-900/20 border-emerald-500/40'}`}>
            <div className="flex justify-between items-end mb-4">
              <label className={`text-xs uppercase font-black tracking-widest ${results.totalCost > 0 && (results.netProfitUnit / results.totalCost) < 0.15 ? 'text-red-400' : 'text-emerald-400'}`}>Ganancia Neta</label>
              <span className={`text-[10px] uppercase font-black ${results.totalCost > 0 && (results.netProfitUnit / results.totalCost) < 0.15 ? 'text-red-600' : 'text-emerald-600'}`}>Por Unidad</span>
            </div>
            <div className={`text-5xl font-black tracking-tighter mb-6 ${results.totalCost > 0 && (results.netProfitUnit / results.totalCost) < 0.15 ? 'text-red-100' : 'text-emerald-400'}`}>
              {formatCLP(results.netProfitUnit)}
            </div>
            <div className={`mt-4 pt-6 border-t space-y-3 ${results.totalCost > 0 && (results.netProfitUnit / results.totalCost) < 0.15 ? 'border-red-500/20' : 'border-emerald-500/20'}`}>
              <div className="flex justify-between text-xs items-center">
                <span className="text-slate-500 font-bold uppercase tracking-tighter">Ganancia x Compra ({costs.purchaseType}):</span>
                <span className={`font-black font-mono text-base ${results.totalCost > 0 && (results.netProfitUnit / results.totalCost) < 0.15 ? 'text-red-400' : 'text-emerald-400'}`}>{formatCLP(results.netProfitBox)}</span>
              </div>
              <div className="flex justify-between text-xs items-center">
                <span className="text-slate-500 font-bold uppercase tracking-tighter">Punto Equilibrio (Caja):</span>
                <span className="text-blue-400 font-black font-mono text-sm underline decoration-blue-500/30 underline-offset-4">Vender {Math.ceil(results.breakEvenUnits)} Unid.</span>
              </div>
              <div className="flex justify-between text-xs items-center">
                <span className="text-slate-500 font-bold uppercase tracking-tighter">ROI Estimado:</span>
                <span className={`font-black font-mono text-sm px-2 py-0.5 rounded ${results.totalCost > 0 && (results.netProfitUnit / results.totalCost) < 0.15 ? 'text-white bg-red-600 animate-pulse' : 'text-emerald-400'}`}>
                  {results.totalCost > 0 ? ((results.netProfitUnit / results.totalCost) * 100).toFixed(1) : '0'}%
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
        ) : (
          <div className="space-y-6 animate-in fade-in duration-500">
            {/* Inventory Dashboard Header */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <section className={`${themeClasses.sectionBg} p-6 rounded-xl border col-span-1 md:col-span-2`}>
                <div className="flex justify-between items-center mb-6">
                  <h2 className={`text-xs font-bold ${themeClasses.accent} uppercase tracking-widest flex items-center gap-2`}>
                    <ChartBar className="w-4 h-4" /> Distribución de Margen (ROI)
                  </h2>
                  <div className="flex gap-4">
                    {marginChartData.map(range => (
                      <div key={range.name} className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: range.color }}></div>
                        <span className="text-[10px] text-slate-500 font-bold">{range.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="h-[200px] w-full mt-4">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={marginChartData}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={settings.theme === 'dark' ? '#334155' : '#e2e8f0'} />
                      <XAxis 
                        dataKey="name" 
                        axisLine={false} 
                        tickLine={false} 
                        tick={{ fontSize: 10, fill: '#64748b', fontWeight: 'bold' }} 
                      />
                      <YAxis 
                        axisLine={false} 
                        tickLine={false} 
                        tick={{ fontSize: 10, fill: '#64748b' }} 
                      />
                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: settings.theme === 'dark' ? '#0f172a' : '#ffffff',
                          border: 'none',
                          borderRadius: '8px',
                          boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
                          fontSize: '12px',
                          color: '#64748b'
                        }}
                        cursor={{ fill: settings.theme === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.02)' }}
                      />
                      <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                        {marginChartData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </section>

              <section className={`${themeClasses.sectionBg} p-6 rounded-xl border flex flex-col justify-between`}>
                <h2 className={`text-xs font-bold ${themeClasses.accent} uppercase tracking-widest flex items-center gap-2 mb-4`}>
                   <LayoutDashboard className="w-4 h-4" /> Resumen Global
                </h2>
                <div className="space-y-4">
                  <div className={`p-4 rounded-lg ${themeClasses.inner} border ${settings.theme === 'dark' ? 'border-slate-700' : 'border-slate-200'}`}>
                    <span className="text-[10px] text-slate-500 uppercase font-black block mb-1">Inversión Total</span>
                    <span className={`text-2xl font-black ${themeClasses.text}`}>{formatCLP(dashboardStats.totalInventoryVal)}</span>
                  </div>
                  <div className={`p-4 rounded-lg ${themeClasses.inner} border ${settings.theme === 'dark' ? 'border-slate-700' : 'border-slate-200'}`}>
                    <span className="text-[10px] text-slate-500 uppercase font-black block mb-1">Productos Registrados</span>
                    <span className={`text-2xl font-black ${themeClasses.text}`}>{dashboardStats.totalItems} SKUs</span>
                  </div>
                  <button 
                    onClick={downloadCSV}
                    className="w-full py-2.5 bg-amber-600/10 border border-amber-600/30 text-amber-500 rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-amber-600/20 transition-all flex items-center justify-center gap-2"
                  >
                    <Download className="w-3.5 h-3.5" /> Exportar Base Completa
                  </button>
                </div>
              </section>
            </div>

            {/* Inventory List Section */}
            <section className={`${themeClasses.sectionBg} rounded-xl border overflow-hidden`}>
               <div className="p-6 border-b border-slate-700/50 flex flex-col md:flex-row justify-between items-center gap-4">
                  <div className="relative w-full md:w-96">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <input 
                      type="text" 
                      placeholder="Buscar por nombre, proveedor o código..."
                      value={searchTerm}
                      onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
                      className={`w-full ${themeClasses.inputBg} rounded-lg pl-10 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all`}
                    />
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-xs text-slate-500 font-bold">Página {currentPage} de {totalPages || 1}</span>
                    <div className="flex gap-1">
                      <button 
                        disabled={currentPage === 1}
                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                        className="p-1.5 rounded-lg border border-slate-700 bg-slate-800 disabled:opacity-30 hover:bg-slate-700 transition-all"
                      >
                         <HistoryIcon className="w-4 h-4 rotate-180" />
                      </button>
                      <button 
                        disabled={currentPage === totalPages || totalPages === 0}
                        onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                        className="p-1.5 rounded-lg border border-slate-700 bg-slate-800 disabled:opacity-30 hover:bg-slate-700 transition-all"
                      >
                         <HistoryIcon className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
               </div>

               <div className="overflow-x-auto">
                 <table className="w-full text-left border-collapse">
                   <thead>
                     <tr className={`text-[10px] uppercase font-black tracking-widest ${settings.theme === 'dark' ? 'bg-slate-900/50 text-slate-500' : 'bg-slate-50 text-slate-400'}`}>
                       <th className="px-6 py-4">Producto</th>
                       <th className="px-6 py-4">Costo Total</th>
                       <th className="px-6 py-4">Precio Mostrador</th>
                       <th className="px-6 py-4 text-red-500">Precio App</th>
                       <th className="px-6 py-4">Ganancia %</th>
                       <th className="px-6 py-4 text-right">Acciones</th>
                     </tr>
                   </thead>
                   <tbody className="divide-y divide-slate-700/30">
                     {paginatedHistory.length === 0 ? (
                       <tr>
                         <td colSpan={6} className="px-6 py-20 text-center text-slate-500 italic text-sm">
                           No se encontraron productos registrados.
                         </td>
                       </tr>
                     ) : (
                       paginatedHistory.map((item) => (
                         <motion.tr 
                           layout
                           key={item.id}
                           className={`${settings.theme === 'dark' ? 'hover:bg-slate-700/20' : 'hover:bg-slate-50'} transition-colors group`}
                         >
                           <td className="px-6 py-4">
                             <div className="flex flex-col">
                               <span className={`text-sm font-bold ${themeClasses.text} group-hover:text-blue-500 transition-colors uppercase`}>{item.name}</span>
                               <span className="text-[10px] text-slate-500 font-mono">{item.barcode || 'SIN CÓDIGO'} | {item.date}</span>
                             </div>
                           </td>
                           <td className="px-6 py-4">
                             <span className={`text-sm font-bold ${themeClasses.text} font-mono`}>{formatCLP(item.totalCost)}</span>
                           </td>
                           <td className="px-6 py-4">
                             <span className="text-sm font-black text-blue-500 font-mono">{formatCLP(smartRound(item.counterPrice, costs.roundingMode))}</span>
                           </td>
                           <td className="px-6 py-4">
                             <span className="text-sm font-black text-red-500 font-mono">{formatCLP(smartRound(item.pedidosYaPrice, costs.roundingMode))}</span>
                           </td>
                           <td className="px-6 py-4">
                             <span className={`text-xs font-black px-2 py-1 rounded ${(item.netProfitUnit / (item.totalCost || 1)) < 0.15 ? 'bg-red-500/10 text-red-500' : 'bg-emerald-500/10 text-emerald-500'}`}>
                               {((item.netProfitUnit / (item.totalCost || 1)) * 100).toFixed(1)}% ROI
                             </span>
                           </td>
                           <td className="px-6 py-4 text-right">
                             <button 
                               onClick={() => deleteProduct(item.id)}
                               className="p-2 text-slate-600 hover:text-red-500 transition-colors"
                               title="Eliminar de la base"
                             >
                               <Trash2 className="w-4 h-4" />
                             </button>
                           </td>
                         </motion.tr>
                       ))
                     )}
                   </tbody>
                 </table>
               </div>
            </section>
          </div>
        )}
      </main>

      {/* Bottom Console / History Bar */}
      <footer className={`mx-6 mb-6 ${settings.theme === 'dark' ? 'bg-slate-950 border-slate-800' : 'bg-white border-slate-200'} p-3 rounded border flex flex-col md:flex-row justify-between items-center gap-4 no-print transition-colors`}>
        <div className="flex gap-3">
          <div className={`text-[10px] ${settings.theme === 'dark' ? 'bg-slate-900 border-slate-700 text-slate-500' : 'bg-slate-50 border-slate-200 text-slate-400'} px-3 py-1 rounded border font-bold tracking-tighter flex items-center gap-2`}>
            <span className={`${settings.theme === 'dark' ? 'text-slate-700' : 'text-slate-300'} font-black uppercase`}>ESC:</span> Limpiar
          </div>
          <button 
            onClick={() => setShowHistory(!showHistory)}
            className={`text-[10px] ${settings.theme === 'dark' ? 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700' : 'bg-slate-100 border-slate-200 text-slate-600 hover:bg-slate-200'} px-3 py-1 rounded border font-bold tracking-tighter transition-colors uppercase`}
          >
            <span className="text-blue-500 font-black mr-1">F2:</span> Historial
          </button>
          <button 
            onClick={downloadCSV}
            className={`text-[10px] ${settings.theme === 'dark' ? 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700' : 'bg-slate-100 border-slate-200 text-slate-600 hover:bg-slate-200'} px-3 py-1 rounded border font-bold tracking-tighter transition-colors uppercase`}
          >
            <span className="text-amber-500 font-black mr-1">F5:</span> Exportar CSV
          </button>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className={`w-1.5 h-1.5 rounded-full ${isSyncing ? 'bg-blue-500 animate-pulse' : 'bg-emerald-500'}`}></span>
            <span className={`text-[10px] ${themeClasses.subText} uppercase font-black tracking-widest flex items-center gap-2`}>
              {isSyncing ? <RefreshCw className="w-3 h-3 animate-spin" /> : null}
              Estado: {isSyncing ? 'Sincronizando...' : 'Nube Sincronizada'} - {settings.storeName}
              {userRole === 'admin' && (
                <span className="ml-2 px-1.5 py-0.5 rounded border border-amber-500/30 text-amber-500 text-[8px] font-black">ROOT</span>
              )}
            </span>
          </div>
          <div className={`h-4 w-px ${settings.theme === 'dark' ? 'bg-slate-800' : 'bg-slate-200'}`}></div>
          <p className={`text-[9px] font-mono ${settings.theme === 'dark' ? 'text-slate-700' : 'text-slate-400'}`}>v2.2.0-STABLE</p>
        </div>
      </footer>

      {/* Print Only Label (Rendered outside main layout) */}
      <div id="printable-label" className="hidden">
        <div className="flex flex-col h-full justify-between p-2">
          <div className="text-center border-b border-slate-200 pb-2">
            <h3 className="text-black font-black text-2xl uppercase leading-none truncate mb-1">{product.name || 'PRODUCTO'}</h3>
            <p className="text-gray-600 text-[11px] uppercase font-bold tracking-widest leading-none">
              {product.volume || '-'} | {product.alcoholGrade || '-'}
            </p>
          </div>
          
          <div className="flex justify-between items-end gap-2">
            <div className="text-black flex-1">
              <p className="text-[10px] font-bold uppercase mb-[-2px] text-gray-500">Precio Venta</p>
              <p className="text-5xl font-black tracking-tighter leading-none">{formatCLP(smartRound(results.counterPrice, costs.roundingMode))}</p>
            </div>
            <div className="w-32 flex flex-col items-end shrink-0 overflow-hidden">
              <Barcode 
                value={product.barcode || '000000000000'} 
                width={1.2}
                height={40}
                margin={0}
                displayValue={false}
              />
              <p className="text-[8px] font-mono text-black font-bold tracking-widest mt-1 uppercase">{product.barcode || 'NO CODE'}</p>
            </div>
          </div>
        </div>
      </div>

      {/* History Drawer Overlay */}
      <AnimatePresence>
        {showHistory && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowHistory(false)}
              className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-40 no-print"
            />
            <motion.aside
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed top-0 right-0 h-full w-full max-w-md bg-slate-900 z-50 border-l border-slate-700 shadow-2xl flex flex-col no-print"
            >
              <div className="p-6 border-b border-slate-800 flex items-center justify-between bg-slate-950">
                <h2 className="font-bold text-lg flex items-center gap-3 text-blue-400 uppercase tracking-widest">
                  <HistoryIcon className="w-5 h-5" /> Historial de Procesos
                </h2>
                <button onClick={() => setShowHistory(false)} className="p-2 hover:bg-slate-800 rounded-full transition-colors text-slate-500">
                  <Trash2 className="w-5 h-5 rotate-45" />
                </button>
              </div>
              
              <div className="flex-1 overflow-y-auto p-4 space-y-6">
                {/* Store Settings Section */}
                <div className={`${settings.theme === 'dark' ? 'bg-slate-950/50' : 'bg-slate-100'} p-5 rounded-xl border ${settings.theme === 'dark' ? 'border-slate-700' : 'border-slate-200'} space-y-4`}>
                  <h3 className="text-[10px] text-blue-500 font-black uppercase tracking-widest flex items-center gap-2">
                    <Home className="w-3.5 h-3.5" /> Identidad del Local
                  </h3>
                  <div className="space-y-1">
                    <label className="text-[9px] text-slate-500 uppercase font-black">Nombre de la Sucursal / Local</label>
                    <input 
                      type="text" 
                      name="storeName"
                      value={settings.storeName}
                      onChange={handleSettingsChange}
                      placeholder="Ej. Boutique del Licor"
                      className={`w-full ${settings.theme === 'dark' ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-300 text-slate-900'} border rounded px-3 py-2 text-xs font-bold`}
                    />
                  </div>
                </div>

                {/* Dashboard Stats */}
                <div className="grid grid-cols-2 gap-3">
                   <div className={`${settings.theme === 'dark' ? 'bg-blue-900/10 border-blue-500/20' : 'bg-blue-50 border-blue-200'} p-4 rounded-xl border`}>
                      <span className="text-[8px] text-blue-500 uppercase font-bold tracking-widest block mb-1">Total SKU</span>
                      <span className="text-2xl font-black text-blue-400">{dashboardStats.totalItems}</span>
                   </div>
                   <div className={`${settings.theme === 'dark' ? 'bg-emerald-900/10 border-emerald-500/20' : 'bg-emerald-50 border-emerald-200'} p-4 rounded-xl border`}>
                      <span className="text-[8px] text-emerald-500 uppercase font-bold tracking-widest block mb-1">ROI Promedio</span>
                      <span className="text-2xl font-black text-emerald-400">{dashboardStats.avgROI.toFixed(1)}%</span>
                   </div>
                </div>

                {/* Inventory Value Dashboard */}
                <div className={`${settings.theme === 'dark' ? 'bg-slate-950' : 'bg-slate-100'} p-5 rounded-xl border ${settings.theme === 'dark' ? 'border-slate-700' : 'border-slate-200'} relative overflow-hidden`}>
                  <div className="relative z-10">
                    <label className="text-[9px] text-slate-500 uppercase font-black tracking-widest mb-2 block">Inversión Estimada en Historial</label>
                    <p className="text-3xl font-black text-blue-400 tracking-tighter">{formatCLP(dashboardStats.totalInventoryVal)}</p>
                  </div>
                  <PieChart className="absolute right-[-10px] bottom-[-10px] w-24 h-24 opacity-5 text-blue-400" />
                </div>
                {/* Commission Settings Section */}
                <div className="bg-slate-950 p-5 rounded-xl border border-slate-700 space-y-4">
                  <h3 className="text-[10px] text-blue-400 font-black uppercase tracking-widest flex items-center gap-2">
                    <Calculator className="w-3 h-3" /> Configuración de Comisiones
                  </h3>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-[9px] text-slate-500 uppercase font-black">Débito (%)</label>
                      <input 
                        type="number" 
                        step="0.1"
                        name="debit"
                        value={commissions.debit}
                        onChange={handleCommissionChange}
                        className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs font-mono text-blue-100"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[9px] text-slate-500 uppercase font-black">Crédito (%)</label>
                      <input 
                        type="number" 
                        step="0.1"
                        name="credit"
                        value={commissions.credit}
                        onChange={handleCommissionChange}
                        className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs font-mono text-blue-100"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 pt-2 border-t border-slate-800">
                    <div className="space-y-1">
                      <label className="text-[9px] text-slate-500 uppercase font-black">App Name</label>
                      <input 
                        type="text" 
                        name="deliveryName"
                        value={commissions.deliveryName}
                        onChange={handleCommissionChange}
                        className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-red-400 font-bold"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[9px] text-slate-500 uppercase font-black">App Com. (%)</label>
                      <input 
                        type="number" 
                        step="0.1"
                        name="delivery"
                        value={commissions.delivery}
                        onChange={handleCommissionChange}
                        className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs font-mono text-red-100"
                      />
                    </div>
                    <div className="space-y-1 col-span-2">
                      <label className="text-[9px] text-slate-500 uppercase font-black">Costo de Bolsa / Empaque ($)</label>
                      <input 
                        type="number" 
                        name="packagingCost"
                        value={commissions.packagingCost}
                        onChange={handleCommissionChange}
                        placeholder="Ej. 500"
                        className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs font-mono text-amber-100"
                      />
                      <p className="text-[8px] text-slate-600 italic">Este costo se suma al precio base antes de la comisión en el App.</p>
                    </div>
                  </div>
                </div>

                <div className="h-px bg-slate-800 my-2" />

                {history.length === 0 ? (
                  <div className="py-20 flex flex-col items-center justify-center text-slate-700 gap-4 opacity-40">
                    <Database className="w-16 h-16" />
                    <p className="text-xs font-black uppercase tracking-widest">No hay registros de proceso</p>
                  </div>
                ) : (
                  history.map((item) => (
                    <motion.div 
                      key={item.id}
                      layout
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="p-5 bg-slate-800/40 rounded-xl border border-slate-700 hover:border-blue-500/50 transition-all cursor-pointer group"
                    >
                      <div className="flex justify-between items-start mb-4">
                        <div>
                          <h4 className="font-black text-sm text-slate-100 group-hover:text-blue-400 transition-colors uppercase tracking-tight">{item.name}</h4>
                          <div className="flex items-center gap-2 mt-1">
                             <span className="text-[9px] bg-slate-900 text-slate-500 px-2 py-0.5 rounded uppercase font-bold">{item.date}</span>
                             <span className="text-[9px] bg-blue-900/30 text-blue-400 px-2 py-0.5 rounded uppercase font-bold">{item.purchaseType}</span>
                             {item.supplier && (
                               <span className="text-[9px] bg-amber-900/30 text-amber-400 px-2 py-0.5 rounded uppercase font-bold">Prov: {item.supplier}</span>
                             )}
                          </div>
                        </div>
                              <div className="flex items-center gap-2">
                                <button 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    deleteProduct(item.id);
                                  }}
                                  className="p-2 hover:bg-red-500/10 text-slate-600 hover:text-red-500 rounded transition-all opacity-0 group-hover:opacity-100"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                                <span className="text-sm font-black text-blue-400 font-mono">
                                  {formatCLP(smartRound(item.counterPrice, costs.roundingMode))}
                                </span>
                              </div>
                      </div>
                      <div className="grid grid-cols-3 gap-4 text-[9px] font-mono border-t border-slate-800 pt-4 mt-2">
                        <div className="space-y-1">
                          <p className="text-slate-600 uppercase font-black">BRUTO UNIT</p>
                          <p className="text-slate-300 font-bold">{formatCLP(item.totalCost)}</p>
                        </div>
                        <div className="space-y-1">
                          <p className="text-slate-600 uppercase font-black">APP PRICE</p>
                          <p className="text-red-400 font-bold">{formatCLP(smartRound(item.pedidosYaPrice, costs.roundingMode))}</p>
                        </div>
                        <div className="space-y-1">
                          <p className="text-slate-600 uppercase font-black">NET PROFIT</p>
                          <p className="text-emerald-400 font-black">{formatCLP(item.netProfitUnit)}</p>
                        </div>
                      </div>
                    </motion.div>
                  ))
                )}
              </div>

              <div className="p-6 bg-slate-950 border-t border-slate-800 grid grid-cols-2 gap-4">
                <button 
                  onClick={clearHistory}
                  className="flex items-center justify-center gap-2 px-4 py-4 bg-slate-900 border border-slate-700 rounded text-[10px] font-black uppercase tracking-widest text-slate-500 hover:bg-slate-800 hover:text-red-400 transition-all"
                >
                  <Trash2 className="w-4 h-4" /> Borrar Todo
                </button>
                <button 
                  onClick={downloadCSV}
                  className="flex items-center justify-center gap-2 px-4 py-4 bg-blue-600 text-white rounded text-[10px] font-black uppercase tracking-widest hover:bg-blue-50 transition-all hover:text-blue-600 shadow-xl"
                >
                  <Download className="w-4 h-4" /> Exportar CSV
                </button>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
