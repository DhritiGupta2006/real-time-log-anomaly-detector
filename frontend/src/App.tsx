import { useState, useEffect } from 'react'
import { PipelineIntro } from '@/components/PipelineIntro'
import { Dashboard } from '@/components/dashboard/Dashboard'
import { MoreInfoPage } from '@/components/MoreInfoPage'

export default function App() {
  const [currentRoute, setCurrentRoute] = useState<'intro' | 'dashboard' | 'info'>(() => {
    if (typeof window !== 'undefined') {
      const path = window.location.pathname
      if (path === '/dashboard' || path.startsWith('/dashboard')) {
        return 'dashboard'
      }
      if (path === '/info' || path.startsWith('/info')) {
        return 'info'
      }
    }
    return 'intro'
  })

  useEffect(() => {
    const handlePopState = () => {
      const path = window.location.pathname
      if (path === '/dashboard' || path.startsWith('/dashboard')) {
        setCurrentRoute('dashboard')
      } else if (path === '/info' || path.startsWith('/info')) {
        setCurrentRoute('info')
      } else {
        setCurrentRoute('intro')
      }
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  const navigateToDashboard = () => {
    if (typeof window !== 'undefined') {
      try {
        window.history.pushState({}, '', '/dashboard')
      } catch {}
    }
    setCurrentRoute('dashboard')
  }

  const navigateToIntro = () => {
    if (typeof window !== 'undefined') {
      try {
        window.history.pushState({}, '', '/')
      } catch {}
    }
    setCurrentRoute('intro')
  }

  const navigateToInfo = () => {
    if (typeof window !== 'undefined') {
      try {
        window.history.pushState({}, '', '/info')
      } catch {}
    }
    setCurrentRoute('info')
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-[#ededed]">
      {currentRoute === 'dashboard' ? (
        <Dashboard
          onNavigateToIntro={navigateToIntro}
          onNavigateToInfo={navigateToInfo}
        />
      ) : currentRoute === 'info' ? (
        <MoreInfoPage
          onNavigateToIntro={navigateToIntro}
          onNavigateToDashboard={navigateToDashboard}
        />
      ) : (
        <PipelineIntro
          onOpen={navigateToDashboard}
          onOpenInfo={navigateToInfo}
        />
      )}
    </div>
  )
}
